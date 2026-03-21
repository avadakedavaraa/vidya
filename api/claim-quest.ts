// supabase/functions/claim-quest/index.ts
// Awards XP and coins for a completed quest. Idempotent — cannot claim twice.

import {
  handleOptions, ok, err,
  adminClient, requireAuth,
  creditCoins, awardXP,
  validateUUID, AuthError
} from './_shared/utils';

export const config = { runtime: 'edge' };

export default async function (req: Request) {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return err('Method not allowed', req, 405);

  let user: { id: string; email: string };
  try {
    user = await requireAuth(req);
  } catch (e) {
    return err(e instanceof AuthError ? e.message : 'Unauthorized', req, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON body', req, 400);
  }

  const questId = body.quest_id as string;
  if (!validateUUID(questId)) return err('Invalid quest ID', req, 400);

  const db = adminClient();

  // ─── Load quest definition ─────────────────────────────
  const { data: quest, error: questErr } = await db
    .from('quests')
    .select('id, title, xp_reward, coin_reward, target, type, criteria, is_active')
    .eq('id', questId)
    .single();

  if (questErr || !quest) return err('Quest not found', req, 404);
  if (!quest.is_active)   return err('Quest is no longer active', req, 400);

  // ─── Get period start ──────────────────────────────────
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const weekStart = getWeekStart();
  const periodStart = quest.type === 'weekly'
    ? weekStart.toISOString()
    : quest.type === 'milestone'
    ? new Date(0).toISOString() // milestones: all-time
    : today.toISOString();

  // ─── Load progress ─────────────────────────────────────
  const { data: progress, error: progressErr } = await db
    .from('user_quest_progress')
    .select('id, progress, completed, claimed')
    .eq('user_id', user.id)
    .eq('quest_id', questId)
    .gte('period_start', periodStart)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!progress) return err('Quest progress not found. Complete the quest first.', req, 400);
  if (!progress.completed) {
    return err(`Quest not yet complete. Progress: ${progress.progress}/${quest.target}`, req, 400);
  }
  if (progress.claimed) return err('You have already claimed this quest reward.', req, 400);

  // ─── Mark as claimed ───────────────────────────────────
  const { error: claimErr } = await db
    .from('user_quest_progress')
    .update({
      claimed:    true,
      claimed_at: new Date().toISOString(),
    })
    .eq('id', progress.id);

  if (claimErr) {
    console.error('Quest claim update failed:', claimErr);
    return err('Failed to claim quest. Please try again.', req, 500);
  }

  // ─── Award XP ──────────────────────────────────────────
  if (quest.xp_reward > 0) {
    await awardXP(user.id, quest.xp_reward);
  }

  // ─── Award coins (if any) ──────────────────────────────
  if (Number(quest.coin_reward) > 0) {
    await creditCoins(
      user.id,
      Number(quest.coin_reward),
      'quest_reward',
      questId,
      'quest',
      `Quest reward: ${quest.title}`
    );
  }

  // ─── Check for badge unlocks ───────────────────────────
  const badgeSlug = QUEST_BADGE_MAP[quest.criteria];
  if (badgeSlug) {
    await db.from('user_badges')
      .upsert({
        user_id:   user.id,
        badge_slug: badgeSlug,
        category:  getCategoryForCriteria(quest.criteria),
      }, { onConflict: 'user_id,badge_slug' });
  }

  return ok({
    success:     true,
    xp_awarded:  quest.xp_reward,
    coins_awarded: Number(quest.coin_reward),
    quest_title: quest.title,
    message:     `Quest complete! ⚡ +${quest.xp_reward} XP${Number(quest.coin_reward) > 0 ? ` · 🪙 +${quest.coin_reward}` : ''}`,
  }, req);
});

// ─── Helpers ──────────────────────────────────────────────────
const QUEST_BADGE_MAP: Record<string, string> = {
  'sessions_taught':   '5-sessions',
  'bounties_won':      'first-win',
  'gold_verification': 'gold-teacher',
  'portfolio-5':       'portfolio-builder',
};

function getCategoryForCriteria(criteria: string): string {
  if (criteria.includes('session') || criteria.includes('teach')) return 'teach';
  if (criteria.includes('bounty'))                                  return 'bounty';
  if (criteria.includes('gold'))                                    return 'teach';
  return 'special';
}

function getWeekStart(): Date {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
