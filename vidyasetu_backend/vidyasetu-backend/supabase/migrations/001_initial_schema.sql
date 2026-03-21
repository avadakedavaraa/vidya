-- ============================================================
-- VIDYASETU — MASTER DATABASE SCHEMA
-- Migration: 001_initial_schema.sql
-- Run once in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- All tables use UUID PKs, RLS enabled, append-only ledger for coins
-- ============================================================

-- ─── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. USERS
-- Core user profile. Auth handled by Supabase Auth (auth.users).
-- This table extends it with app-specific fields.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  email           TEXT NOT NULL UNIQUE,
  college         TEXT,
  avatar_color    TEXT DEFAULT '#5B45E0',
  role            TEXT NOT NULL DEFAULT 'both' CHECK (role IN ('learner', 'teacher', 'both')),
  bio             TEXT CHECK (char_length(bio) <= 500),
  xp              INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level           INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 50),
  streak_days     INTEGER NOT NULL DEFAULT 0,
  last_active_at  TIMESTAMPTZ DEFAULT NOW(),
  is_verified     BOOLEAN DEFAULT FALSE,
  is_banned       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_or_public"
  ON public.users FOR SELECT
  USING (
    id = auth.uid()
    OR (is_banned = FALSE)  -- public profiles visible to all logged-in users
  );

CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "users_insert_own"
  ON public.users FOR INSERT
  WITH CHECK (id = auth.uid());

-- ─── Indexes ─────────────────────────────────────────────────
CREATE INDEX idx_users_email    ON public.users(email);
CREATE INDEX idx_users_college  ON public.users(college);
CREATE INDEX idx_users_xp       ON public.users(xp DESC);
CREATE INDEX idx_users_role     ON public.users(role);

-- ─── Auto-update updated_at ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 2. SKILLS & VERIFICATION
-- Users can have multiple skills. MCQ-verified ones get a tier badge.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.skills (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  category    TEXT NOT NULL CHECK (category IN (
                'programming','design','language','music','data','marketing','content','other'
              )),
  tier        TEXT NOT NULL DEFAULT 'unverified' CHECK (tier IN (
                'unverified','bronze','silver','gold'
              )),
  coin_rate   NUMERIC(4,1) NOT NULL DEFAULT 1.0 CHECK (coin_rate BETWEEN 0.5 AND 10),
  is_teaching BOOLEAN NOT NULL DEFAULT TRUE,
  is_learning BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "skills_select_all"
  ON public.skills FOR SELECT USING (TRUE);

CREATE POLICY "skills_insert_own"
  ON public.skills FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "skills_update_own"
  ON public.skills FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "skills_delete_own"
  ON public.skills FOR DELETE USING (user_id = auth.uid());

CREATE INDEX idx_skills_user_id  ON public.skills(user_id);
CREATE INDEX idx_skills_category ON public.skills(category);
CREATE INDEX idx_skills_tier     ON public.skills(tier);
CREATE INDEX idx_skills_name     ON public.skills USING gin(to_tsvector('english', name));

-- ============================================================
-- 3. MCQ QUESTION BANK (for skill verification)
-- Matches 13_skill_verify.html question structure exactly.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.mcq_questions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  skill_name   TEXT NOT NULL,              -- 'react', 'python', 'figma', 'javascript', 'ml'
  question     TEXT NOT NULL,
  option_a     TEXT NOT NULL,
  option_b     TEXT NOT NULL,
  option_c     TEXT NOT NULL,
  option_d     TEXT NOT NULL,
  correct      SMALLINT NOT NULL CHECK (correct BETWEEN 0 AND 3), -- 0=A, 1=B, 2=C, 3=D
  difficulty   SMALLINT NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 3),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mcq_questions ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can read questions (not the correct answers - handled in edge fn)
CREATE POLICY "mcq_select_auth"
  ON public.mcq_questions FOR SELECT
  USING (auth.role() = 'authenticated' AND is_active = TRUE);

CREATE INDEX idx_mcq_skill ON public.mcq_questions(skill_name);

-- ============================================================
-- 4. SKILL VERIFICATION ATTEMPTS
-- One attempt = 10 questions. Max 3 attempts per skill per 30 days.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.skill_verifications (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  skill_name   TEXT NOT NULL,
  score        SMALLINT CHECK (score BETWEEN 0 AND 10),  -- questions correct
  pct          SMALLINT CHECK (pct BETWEEN 0 AND 100),   -- percentage
  tier_awarded TEXT CHECK (tier_awarded IN ('bronze','silver','gold')),
  passed       BOOLEAN NOT NULL DEFAULT FALSE,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  time_taken_s INTEGER,
  ip_hash      TEXT  -- hashed IP for fraud detection, never raw IP stored
);

ALTER TABLE public.skill_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "verifications_select_own"
  ON public.skill_verifications FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "verifications_insert_own"
  ON public.skill_verifications FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_verif_user_skill ON public.skill_verifications(user_id, skill_name);
CREATE INDEX idx_verif_created    ON public.skill_verifications(started_at DESC);

-- ============================================================
-- 5. COIN LEDGER (append-only, immutable)
-- NEVER update or delete rows. Balance = SUM of all entries for user.
-- Matches 08_wallet.html TX structure exactly.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.coin_ledger (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount      NUMERIC(8,1) NOT NULL,           -- positive=credit, negative=debit
  type        TEXT NOT NULL CHECK (type IN (
                'welcome_bonus','session_earned','session_spent',
                'bounty_won','bounty_posted','bounty_deposit',
                'bounty_deposit_returned','escrow_lock','escrow_release',
                'escrow_refund','escrow_prorata','quest_reward',
                'xp_bonus','admin_adjustment'
              )),
  ref_id      UUID,            -- booking_id, bounty_id, or quest_id
  ref_type    TEXT CHECK (ref_type IN ('booking','bounty','quest','admin')),
  note        TEXT CHECK (char_length(note) <= 200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- NO updated_at — this table is append-only
);

ALTER TABLE public.coin_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ledger_select_own"
  ON public.coin_ledger FOR SELECT USING (user_id = auth.uid());

-- INSERT only via Edge Functions (service role), never direct from client
CREATE POLICY "ledger_insert_service"
  ON public.coin_ledger FOR INSERT
  WITH CHECK (FALSE); -- blocked for anon + authenticated; only service_role bypasses RLS

CREATE INDEX idx_ledger_user_id  ON public.coin_ledger(user_id);
CREATE INDEX idx_ledger_created  ON public.coin_ledger(created_at DESC);
CREATE INDEX idx_ledger_type     ON public.coin_ledger(type);
CREATE INDEX idx_ledger_ref_id   ON public.coin_ledger(ref_id) WHERE ref_id IS NOT NULL;

-- ─── Convenience view: current balance per user ──────────────
CREATE OR REPLACE VIEW public.user_coin_balances AS
SELECT
  user_id,
  COALESCE(SUM(amount), 0)::NUMERIC(8,1) AS balance,
  COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS total_earned,
  COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS total_spent,
  COUNT(*) AS transaction_count,
  MAX(created_at) AS last_tx_at
FROM public.coin_ledger
GROUP BY user_id;

-- ============================================================
-- 6. BOOKINGS (sessions between learner and teacher)
-- Matches 06_booking.html calendar + 11_my_sessions.html data model.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bookings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  learner_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  teacher_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  skill_id        UUID REFERENCES public.skills(id),
  skill_name      TEXT NOT NULL,
  topic           TEXT,
  note_from_learner TEXT CHECK (char_length(note_from_learner) <= 500),

  -- Schedule
  scheduled_date  DATE NOT NULL,
  start_time      TIME NOT NULL,
  duration_mins   SMALLINT NOT NULL CHECK (duration_mins IN (60, 90, 120, 180)),

  -- Financials
  coin_rate       NUMERIC(4,1) NOT NULL CHECK (coin_rate > 0),
  escrow_amount   NUMERIC(6,1) NOT NULL CHECK (escrow_amount > 0),
  released_amount NUMERIC(6,1) DEFAULT 0,

  -- State machine
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                    'pending','confirmed','active','completed','cancelled',
                    'disputed','partial_refund','refunded'
                  )),

  -- Session tracking
  actual_start_at   TIMESTAMPTZ,
  actual_end_at     TIMESTAMPTZ,
  actual_mins       SMALLINT,
  heartbeat_at      TIMESTAMPTZ,  -- last ping from session room

  -- Review
  learner_rating    SMALLINT CHECK (learner_rating BETWEEN 1 AND 5),
  learner_review    TEXT CHECK (char_length(learner_review) <= 400),
  reviewed_at       TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT no_self_booking CHECK (learner_id != teacher_id)
);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bookings_select_participant"
  ON public.bookings FOR SELECT
  USING (learner_id = auth.uid() OR teacher_id = auth.uid());

CREATE POLICY "bookings_insert_learner"
  ON public.bookings FOR INSERT
  WITH CHECK (learner_id = auth.uid() AND status = 'pending');

CREATE POLICY "bookings_update_participant"
  ON public.bookings FOR UPDATE
  USING (learner_id = auth.uid() OR teacher_id = auth.uid());

CREATE INDEX idx_bookings_learner    ON public.bookings(learner_id);
CREATE INDEX idx_bookings_teacher    ON public.bookings(teacher_id);
CREATE INDEX idx_bookings_status     ON public.bookings(status);
CREATE INDEX idx_bookings_date       ON public.bookings(scheduled_date);
CREATE INDEX idx_bookings_heartbeat  ON public.bookings(heartbeat_at) WHERE status = 'active';

CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 7. BOUNTIES
-- Matches 09_bounty.html BOUNTIES data model exactly.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bounties (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  poster_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 5 AND 120),
  description   TEXT NOT NULL CHECK (char_length(description) BETWEEN 20 AND 2000),
  category      TEXT NOT NULL CHECK (category IN (
                  'design','programming','content','data','marketing','language','music','other'
                )),
  tags          TEXT[] DEFAULT '{}' CHECK (array_length(tags, 1) <= 5),
  coin_reward   NUMERIC(6,1) NOT NULL CHECK (coin_reward >= 1),
  deadline_at   TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                  'open','in_review','completed','cancelled','disputed'
                )),
  winner_id     UUID REFERENCES public.users(id),
  winning_bid_id UUID,  -- FK added after bids table created
  bid_count     INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.bounties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bounties_select_open"
  ON public.bounties FOR SELECT USING (TRUE);

CREATE POLICY "bounties_insert_auth"
  ON public.bounties FOR INSERT
  WITH CHECK (poster_id = auth.uid());

CREATE POLICY "bounties_update_poster"
  ON public.bounties FOR UPDATE
  USING (poster_id = auth.uid());

CREATE INDEX idx_bounties_poster   ON public.bounties(poster_id);
CREATE INDEX idx_bounties_status   ON public.bounties(status);
CREATE INDEX idx_bounties_category ON public.bounties(category);
CREATE INDEX idx_bounties_deadline ON public.bounties(deadline_at);
CREATE INDEX idx_bounties_fts      ON public.bounties USING gin(
  to_tsvector('english', title || ' ' || description)
);

CREATE TRIGGER bounties_updated_at
  BEFORE UPDATE ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 8. BOUNTY BIDS (blind bidding - proposals encrypted client-side)
-- The actual proposal text is AES-256 encrypted before reaching the server.
-- Server stores ciphertext only. Only poster can decrypt.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bounty_bids (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bounty_id         UUID NOT NULL REFERENCES public.bounties(id) ON DELETE CASCADE,
  bidder_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  encrypted_proposal TEXT NOT NULL,     -- AES-256-GCM ciphertext, base64
  encryption_iv     TEXT NOT NULL,      -- IV for AES decryption, base64
  coin_quote        NUMERIC(6,1) NOT NULL CHECK (coin_quote >= 0.5),
  delivery_days     SMALLINT NOT NULL CHECK (delivery_days BETWEEN 1 AND 90),
  portfolio_url     TEXT CHECK (portfolio_url ~ '^https?://'),
  deposit_amount    NUMERIC(6,1) NOT NULL DEFAULT 1, -- 10% deposit, min 1 coin
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                      'pending','selected','rejected','deposit_returned'
                    )),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (bounty_id, bidder_id)  -- one bid per user per bounty
);

-- Wire FK from bounties to winning bid
ALTER TABLE public.bounties
  ADD CONSTRAINT fk_winning_bid
  FOREIGN KEY (winning_bid_id) REFERENCES public.bounty_bids(id);

ALTER TABLE public.bounty_bids ENABLE ROW LEVEL SECURITY;

-- Poster sees all bids (but proposal is encrypted — they need client key to decrypt)
CREATE POLICY "bids_select_poster_or_own"
  ON public.bounty_bids FOR SELECT
  USING (
    bidder_id = auth.uid()
    OR (SELECT poster_id FROM public.bounties WHERE id = bounty_id) = auth.uid()
  );

-- Bidder can insert their own bid
CREATE POLICY "bids_insert_own"
  ON public.bounty_bids FOR INSERT
  WITH CHECK (bidder_id = auth.uid());

CREATE INDEX idx_bids_bounty_id  ON public.bounty_bids(bounty_id);
CREATE INDEX idx_bids_bidder_id  ON public.bounty_bids(bidder_id);
CREATE INDEX idx_bids_status     ON public.bounty_bids(status);

-- ============================================================
-- 9. CHAT MESSAGES
-- Private rooms keyed to booking_id. Persisted for dispute evidence.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id  UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  msg_type    TEXT NOT NULL DEFAULT 'text' CHECK (msg_type IN ('text','file','system')),
  file_url    TEXT,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,  -- soft delete only
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Never allow UPDATE — immutable for evidence
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_select_participant"
  ON public.chat_messages FOR SELECT
  USING (
    (SELECT COUNT(*) FROM public.bookings
     WHERE id = booking_id
     AND (learner_id = auth.uid() OR teacher_id = auth.uid())) > 0
  );

CREATE POLICY "messages_insert_participant"
  ON public.chat_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND (SELECT COUNT(*) FROM public.bookings
         WHERE id = booking_id
         AND (learner_id = auth.uid() OR teacher_id = auth.uid())) > 0
  );

CREATE INDEX idx_messages_booking  ON public.chat_messages(booking_id, created_at);
CREATE INDEX idx_messages_sender   ON public.chat_messages(sender_id);

-- ============================================================
-- 10. QUESTS
-- Matches 10_quest.html QUESTS array exactly.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug         TEXT NOT NULL UNIQUE,   -- e.g. 'teach-session-daily'
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('daily','weekly','milestone')),
  icon         TEXT NOT NULL DEFAULT '⚔️',
  icon_bg      TEXT DEFAULT 'var(--indigo-light)',
  xp_reward    INTEGER NOT NULL CHECK (xp_reward >= 0),
  coin_reward  NUMERIC(4,1) NOT NULL DEFAULT 0,
  target       INTEGER NOT NULL DEFAULT 1,  -- how many times to do the action
  criteria     TEXT NOT NULL,   -- machine-readable: 'sessions_taught', 'bounties_won', etc.
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.quests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quests_select_all" ON public.quests FOR SELECT USING (is_active = TRUE);

-- ============================================================
-- 11. USER QUEST PROGRESS
-- Tracks progress per user per quest. Resets daily/weekly via cron.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_quest_progress (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  quest_id     UUID NOT NULL REFERENCES public.quests(id) ON DELETE CASCADE,
  progress     INTEGER NOT NULL DEFAULT 0,
  completed    BOOLEAN NOT NULL DEFAULT FALSE,
  claimed      BOOLEAN NOT NULL DEFAULT FALSE,
  period_start TIMESTAMPTZ NOT NULL DEFAULT DATE_TRUNC('day', NOW()),
  completed_at TIMESTAMPTZ,
  claimed_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, quest_id, period_start)
);

ALTER TABLE public.user_quest_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quest_progress_select_own"
  ON public.user_quest_progress FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "quest_progress_insert_own"
  ON public.user_quest_progress FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "quest_progress_update_own"
  ON public.user_quest_progress FOR UPDATE USING (user_id = auth.uid());

CREATE INDEX idx_quest_progress_user  ON public.user_quest_progress(user_id);
CREATE INDEX idx_quest_progress_quest ON public.user_quest_progress(quest_id);

-- ============================================================
-- 12. BADGES
-- Earned badges stored per user. Matches 10_quest.html BADGES object.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_badges (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  badge_slug TEXT NOT NULL,   -- 'first-lesson', '5-sessions', 'gold-teacher', etc.
  category   TEXT NOT NULL CHECK (category IN ('teach','learn','bounty','special')),
  earned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, badge_slug)
);

ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "badges_select_all"   ON public.user_badges FOR SELECT USING (TRUE);
CREATE POLICY "badges_insert_service" ON public.user_badges FOR INSERT WITH CHECK (FALSE);

CREATE INDEX idx_badges_user ON public.user_badges(user_id);

-- ============================================================
-- 13. GAME QUESTIONS (14_game_learn.html — Supabase DB mode)
-- AI-generated questions cached here to reduce API calls & cost.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.game_questions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  language       TEXT NOT NULL CHECK (language IN (
                   'python','javascript','cpp','java','sql','html','css'
                 )),
  theme          TEXT NOT NULL,   -- 'murder','space','heist','sports','fantasy','cooking'
  level          SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 10),
  question_text  TEXT NOT NULL,
  narrative      TEXT,
  code_snippet   TEXT,
  option_a       TEXT NOT NULL,
  option_b       TEXT NOT NULL,
  option_c       TEXT NOT NULL,
  option_d       TEXT NOT NULL,
  correct        TEXT NOT NULL CHECK (correct IN ('a','b','c','d')),
  correct_code   TEXT,
  explanation    TEXT NOT NULL,
  hint           TEXT,
  coin_reward    SMALLINT NOT NULL DEFAULT 1,
  play_count     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.game_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "game_q_select_auth"
  ON public.game_questions FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "game_q_insert_auth"
  ON public.game_questions FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX idx_gq_lang_theme_level
  ON public.game_questions(language, theme, level);

-- ============================================================
-- 14. DISPUTES
-- For session and bounty conflicts. Immutable once filed.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.disputes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  filed_by      UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  against       UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  ref_id        UUID NOT NULL,   -- booking_id or bounty_id
  ref_type      TEXT NOT NULL CHECK (ref_type IN ('booking','bounty')),
  reason        TEXT NOT NULL CHECK (char_length(reason) BETWEEN 20 AND 2000),
  evidence_urls TEXT[] DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                  'open','under_review','resolved_for_filer',
                  'resolved_for_defendant','split','closed'
                )),
  resolution    TEXT,
  resolved_by   UUID REFERENCES public.users(id),
  resolved_at   TIMESTAMPTZ,
  auto_resolve_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "disputes_select_participant"
  ON public.disputes FOR SELECT
  USING (filed_by = auth.uid() OR against = auth.uid());

CREATE POLICY "disputes_insert_own"
  ON public.disputes FOR INSERT
  WITH CHECK (filed_by = auth.uid());

CREATE INDEX idx_disputes_filed_by ON public.disputes(filed_by);
CREATE INDEX idx_disputes_ref      ON public.disputes(ref_id, ref_type);
CREATE INDEX idx_disputes_status   ON public.disputes(status);

-- ============================================================
-- 15. AVAILABILITY SLOTS (teacher schedule)
-- Teachers set when they're available for bookings.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.availability_slots (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  day_of_week SMALLINT CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun, null=specific date
  specific_date DATE,                         -- for one-off availability
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  is_recurring BOOLEAN NOT NULL DEFAULT TRUE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (start_time < end_time),
  CHECK (day_of_week IS NOT NULL OR specific_date IS NOT NULL)
);

ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "avail_select_all"   ON public.availability_slots FOR SELECT USING (TRUE);
CREATE POLICY "avail_insert_own"   ON public.availability_slots FOR INSERT WITH CHECK (teacher_id = auth.uid());
CREATE POLICY "avail_update_own"   ON public.availability_slots FOR UPDATE USING (teacher_id = auth.uid());
CREATE POLICY "avail_delete_own"   ON public.availability_slots FOR DELETE USING (teacher_id = auth.uid());

CREATE INDEX idx_avail_teacher ON public.availability_slots(teacher_id, is_active);

-- ============================================================
-- 16. OTP TOKENS (email verification)
-- Short-lived, single-use. Cleaned up by cron.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.otp_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email      TEXT NOT NULL,
  token_hash TEXT NOT NULL,    -- SHA-256 hash of the 6-digit OTP, never plain
  purpose    TEXT NOT NULL CHECK (purpose IN ('signup','login','reset_password')),
  attempts   SMALLINT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.otp_tokens ENABLE ROW LEVEL SECURITY;
-- No direct client access — only via Edge Functions (service role)
CREATE POLICY "otp_no_direct_access" ON public.otp_tokens FOR ALL USING (FALSE);

CREATE INDEX idx_otp_email   ON public.otp_tokens(email, expires_at);
CREATE INDEX idx_otp_expires ON public.otp_tokens(expires_at);  -- for cron cleanup

-- ============================================================
-- 17. RATE LIMIT LOG (lightweight fraud/abuse guard)
-- Edge functions write here to enforce per-IP / per-user limits.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rate_limit_log (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key        TEXT NOT NULL,    -- 'otp:email@x.com', 'auth:1.2.3.0', 'bid:user_id'
  action     TEXT NOT NULL,
  count      SMALLINT NOT NULL DEFAULT 1,
  window_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.rate_limit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rate_limit_no_direct" ON public.rate_limit_log FOR ALL USING (FALSE);

CREATE INDEX idx_rate_key_window ON public.rate_limit_log(key, window_end);

-- ============================================================
-- SEED: DEFAULT QUESTS (matches 10_quest.html QUESTS array)
-- ============================================================
INSERT INTO public.quests (slug, title, description, type, icon, icon_bg, xp_reward, coin_reward, target, criteria) VALUES
  ('teach-session-daily',   'Teach a session today',         'Complete at least one teaching session today.',                         'daily',     '🎓', 'var(--coin-light)',   100, 0.5, 1, 'sessions_taught'),
  ('book-session-daily',    'Book a learning session',        'Schedule a session with any verified teacher.',                         'daily',     '📚', 'var(--indigo-light)',  50, 0.0, 1, 'sessions_booked'),
  ('leave-reviews-daily',   'Leave 2 reviews',               'Rate and review teachers from your completed sessions.',               'daily',     '⭐', 'rgba(22,162,123,.1)', 30, 0.0, 2, 'reviews_left'),
  ('submit-bid-daily',      'Submit a bounty bid',           'Browse the Bounty Hub and place a bid on an active bounty.',          'daily',     '🎯', 'rgba(232,64,64,.1)',  40, 0.0, 1, 'bids_submitted'),
  ('streak-daily',          'Maintain your streak',          'Log in and complete any activity to keep your streak alive.',         'daily',     '🔥', 'rgba(245,166,35,.12)', 20, 0.0, 1, 'daily_login'),
  ('teach-5-weekly',        'Teach 5 sessions this week',    'Become a weekly teaching champion. Gold tier earns 2x coins.',        'weekly',    '📖', 'var(--indigo-light)',  300, 2.0, 5, 'sessions_taught'),
  ('earn-10-coins-weekly',  'Earn 10 coins this week',       'Maximize your coin earnings through teaching, bounties, and quests.', 'weekly',    '🪙', 'var(--coin-light)',   200, 1.0, 10, 'coins_earned'),
  ('achieve-gold',          'Achieve Gold Expert status',    'Pass the MCQ verification test with 95%+ score in any skill.',        'milestone', '🥇', 'var(--coin-light)',   500, 5.0, 1, 'gold_verification'),
  ('portfolio-5',           'Build your portfolio (5 items)', 'Complete 5 bounties to auto-generate your public portfolio.',        'milestone', '📜', 'var(--teal-light)',   400, 3.0, 5, 'bounties_won')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- CLEANUP: Auto-expire OTP tokens (cron via pg_cron or Supabase scheduled functions)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.otp_tokens WHERE expires_at < NOW() - INTERVAL '1 hour';
  DELETE FROM public.rate_limit_log WHERE window_end < NOW() - INTERVAL '2 hours';
END;
$$;

-- ============================================================
-- FUNCTION: Get user coin balance (safe, callable from client)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_coin_balance(p_user_id UUID DEFAULT auth.uid())
RETURNS NUMERIC LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COALESCE(SUM(amount), 0)
  FROM public.coin_ledger
  WHERE user_id = p_user_id;
$$;

-- ============================================================
-- FUNCTION: Pro-rata coin calculation for partial sessions
-- ============================================================
CREATE OR REPLACE FUNCTION public.calc_prorata_release(
  p_booking_id UUID,
  p_elapsed_seconds INTEGER
)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_escrow     NUMERIC;
  v_total_secs INTEGER;
  v_release    NUMERIC;
BEGIN
  SELECT escrow_amount, duration_mins * 60
  INTO v_escrow, v_total_secs
  FROM public.bookings
  WHERE id = p_booking_id;

  IF v_total_secs = 0 THEN RETURN 0; END IF;

  v_release := ROUND(
    (LEAST(p_elapsed_seconds, v_total_secs)::NUMERIC / v_total_secs) * v_escrow,
    1
  );
  RETURN GREATEST(v_release, 0);
END;
$$;

-- ============================================================
-- REALTIME: Enable for live session and chat features
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.coin_ledger;
