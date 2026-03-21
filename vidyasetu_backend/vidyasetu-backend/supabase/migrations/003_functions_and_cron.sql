-- ============================================================
-- VIDYASETU — HELPER FUNCTIONS & CRON
-- Migration: 003_functions_and_cron.sql
-- Run after 001_initial_schema.sql
-- ============================================================

-- ─── XP increment + level recalculation ─────────────────────
-- Level formula: floor(sqrt(xp / 100)) + 1, capped at 50
CREATE OR REPLACE FUNCTION public.increment_xp(p_user_id UUID, p_xp INTEGER)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_new_xp    INTEGER;
  v_new_level INTEGER;
BEGIN
  UPDATE public.users
  SET
    xp    = xp + p_xp,
    level = LEAST(FLOOR(SQRT((xp + p_xp)::NUMERIC / 100))::INTEGER + 1, 50)
  WHERE id = p_user_id
  RETURNING xp INTO v_new_xp;
END;
$$;

-- ─── Bid count increment (atomic) ───────────────────────────
CREATE OR REPLACE FUNCTION public.increment_bid_count(p_bounty_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.bounties
  SET bid_count = bid_count + 1
  WHERE id = p_bounty_id AND status = 'open';
END;
$$;

-- ─── Streak update ───────────────────────────────────────────
-- Call on every login / activity. Increments streak if last_active was yesterday.
CREATE OR REPLACE FUNCTION public.update_streak(p_user_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_last_active TIMESTAMPTZ;
  v_streak      INTEGER;
  v_today       DATE := CURRENT_DATE;
  v_yesterday   DATE := CURRENT_DATE - INTERVAL '1 day';
BEGIN
  SELECT last_active_at, streak_days
  INTO v_last_active, v_streak
  FROM public.users
  WHERE id = p_user_id;

  IF v_last_active::DATE = v_today THEN
    -- Already updated today
    RETURN v_streak;
  ELSIF v_last_active::DATE = v_yesterday THEN
    -- Consecutive day — increment
    v_streak := v_streak + 1;
  ELSE
    -- Streak broken
    v_streak := 1;
  END IF;

  UPDATE public.users
  SET streak_days   = v_streak,
      last_active_at = NOW()
  WHERE id = p_user_id;

  RETURN v_streak;
END;
$$;

-- ─── Select teacher profiles for Explore page ────────────────
-- Returns teachers with their skills, ratings, and coin balance.
-- Used by 04_explore.html and 05_teacher_profile.html.
CREATE OR REPLACE FUNCTION public.get_teacher_profiles(
  p_category    TEXT    DEFAULT NULL,
  p_tier        TEXT    DEFAULT NULL,
  p_search      TEXT    DEFAULT NULL,
  p_sort        TEXT    DEFAULT 'rating',    -- 'rating' | 'rate' | 'sessions' | 'online'
  p_limit       INTEGER DEFAULT 20,
  p_offset      INTEGER DEFAULT 0
)
RETURNS TABLE (
  id            UUID,
  name          TEXT,
  college       TEXT,
  avatar_color  TEXT,
  bio           TEXT,
  is_online     BOOLEAN,
  skill_name    TEXT,
  skill_tier    TEXT,
  coin_rate     NUMERIC,
  skill_category TEXT,
  avg_rating    NUMERIC,
  review_count  INTEGER,
  session_count INTEGER,
  total_xp      INTEGER,
  level         INTEGER
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT DISTINCT ON (u.id)
    u.id,
    u.name,
    u.college,
    u.avatar_color,
    u.bio,
    (u.last_active_at > NOW() - INTERVAL '10 minutes') AS is_online,
    s.name           AS skill_name,
    s.tier           AS skill_tier,
    s.coin_rate,
    s.category       AS skill_category,
    COALESCE(
      (SELECT AVG(b.learner_rating)::NUMERIC(3,1)
       FROM public.bookings b
       WHERE b.teacher_id = u.id AND b.learner_rating IS NOT NULL),
      0
    ) AS avg_rating,
    COALESCE(
      (SELECT COUNT(*)::INTEGER
       FROM public.bookings b
       WHERE b.teacher_id = u.id AND b.learner_rating IS NOT NULL),
      0
    ) AS review_count,
    COALESCE(
      (SELECT COUNT(*)::INTEGER
       FROM public.bookings b
       WHERE b.teacher_id = u.id AND b.status = 'completed'),
      0
    ) AS session_count,
    u.xp  AS total_xp,
    u.level
  FROM public.users u
  JOIN public.skills s ON s.user_id = u.id AND s.is_teaching = TRUE AND s.tier != 'unverified'
  WHERE
    u.is_banned = FALSE
    AND u.role IN ('teacher', 'both')
    AND (p_category IS NULL OR s.category = p_category)
    AND (p_tier IS NULL OR s.tier = p_tier)
    AND (p_search IS NULL OR
         u.name ILIKE '%' || p_search || '%' OR
         s.name ILIKE '%' || p_search || '%' OR
         u.college ILIKE '%' || p_search || '%')
  ORDER BY
    u.id,
    CASE WHEN p_sort = 'rating'   THEN (SELECT AVG(b.learner_rating) FROM public.bookings b WHERE b.teacher_id = u.id) END DESC NULLS LAST,
    CASE WHEN p_sort = 'rate'     THEN s.coin_rate END ASC NULLS LAST,
    CASE WHEN p_sort = 'online'   THEN (u.last_active_at > NOW() - INTERVAL '10 minutes') END DESC NULLS LAST,
    u.last_active_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

-- ─── Leaderboard query ───────────────────────────────────────
-- Returns XP leaderboard for weekly/monthly/all-time.
-- Used by 10_quest.html leaderboard tab.
CREATE OR REPLACE FUNCTION public.get_leaderboard(
  p_period TEXT    DEFAULT 'weekly',   -- 'weekly' | 'monthly' | 'all'
  p_limit  INTEGER DEFAULT 20
)
RETURNS TABLE (
  rank        BIGINT,
  user_id     UUID,
  name        TEXT,
  college     TEXT,
  avatar_color TEXT,
  xp_total    BIGINT,
  sessions_taught INTEGER,
  level       INTEGER
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  WITH xp_window AS (
    -- For weekly/monthly, sum bookings + quest completions in window
    -- For simplicity we use the user's total XP column (updated incrementally)
    SELECT
      u.id,
      u.name,
      u.college,
      u.avatar_color,
      u.xp         AS xp_total,
      u.level,
      COALESCE(
        (SELECT COUNT(*)::INTEGER
         FROM public.bookings b
         WHERE b.teacher_id = u.id
           AND b.status = 'completed'
           AND CASE
             WHEN p_period = 'weekly'  THEN b.actual_end_at > NOW() - INTERVAL '7 days'
             WHEN p_period = 'monthly' THEN b.actual_end_at > NOW() - INTERVAL '30 days'
             ELSE TRUE
           END
        ), 0
      ) AS sessions_taught
    FROM public.users u
    WHERE u.is_banned = FALSE
  )
  SELECT
    RANK() OVER (ORDER BY xp_total DESC) AS rank,
    id          AS user_id,
    name,
    college,
    avatar_color,
    xp_total,
    sessions_taught,
    level
  FROM xp_window
  ORDER BY xp_total DESC
  LIMIT p_limit;
$$;

-- ─── Wallet history query ─────────────────────────────────────
-- Returns paginated coin ledger for a user with enriched labels.
-- Used by 08_wallet.html.
CREATE OR REPLACE FUNCTION public.get_wallet_history(
  p_user_id  UUID    DEFAULT auth.uid(),
  p_type     TEXT    DEFAULT NULL,
  p_limit    INTEGER DEFAULT 20,
  p_offset   INTEGER DEFAULT 0
)
RETURNS TABLE (
  id         UUID,
  amount     NUMERIC,
  type       TEXT,
  ref_id     UUID,
  ref_type   TEXT,
  note       TEXT,
  created_at TIMESTAMPTZ
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    id, amount, type, ref_id, ref_type, note, created_at
  FROM public.coin_ledger
  WHERE user_id = p_user_id
    AND (p_type IS NULL OR type = p_type)
  ORDER BY created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

-- ─── Cron job setup (requires pg_cron extension) ─────────────
-- Enable in Supabase Dashboard → Database → Extensions → pg_cron
-- Then run the SELECT below.
-- Calls the release-escrow Edge Function every 5 minutes.

-- SELECT cron.schedule(
--   'vidyasetu-escrow-cron',
--   '*/5 * * * *',
--   $$
--     SELECT net.http_post(
--       url     := current_setting('app.supabase_url') || '/functions/v1/release-escrow',
--       headers := jsonb_build_object(
--         'Content-Type',  'application/json',
--         'Authorization', 'Bearer ' || current_setting('app.cron_secret')
--       ),
--       body    := '{}'::jsonb
--     );
--   $$
-- );

-- OTP cleanup every hour
-- SELECT cron.schedule(
--   'vidyasetu-otp-cleanup',
--   '0 * * * *',
--   'SELECT public.cleanup_expired_otps();'
-- );
