// api/claim-quest.ts
// Awards XP and coins for a completed quest. Idempotent — cannot claim twice.

import { handleOptions, ok, err } from './_shared/responses';
import { adminClient } from './_shared/supabase';
import { requireAuth, AuthError } from './_shared/auth';
import { creditCoins, awardXP } from './_shared/ledger';
import { validateUUID } from './_shared/validation';

export const config = { runtime: 'edge' };

export default async function (req: Request) {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return err('Method not allowed', req, 405);

  let user: { id: string; email: string };
  try { user = await requireAuth(req); }
  catch (e) { return err(e instanceof AuthError ? e.message : 'Unauthorized', req, 401); }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return err('Invalid JSON body', req, 400); }

  const questId = body.quest_id as string;
  if (!validateUUID(questId)) return err('Invalid quest ID', req, 400);

  const db = adminClient();

  const { data: quest, error: questErr } = await db
    .from('quests').select('id, title, xp_reward, coin_reward, target, type, criteria, is_active')
    .eq('id', questId).single();
  if (questErr || !quest) return err('Quest not found', req, 404);
  if (!quest.is_active) return err('Quest is no longer active', req, 400);

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const weekStart = getWeekStart();
  const periodStart = quest.type === 'weekly' ? weekStart.toISOString()
    : quest.type === 'milestone' ? new Date(0).toISOString() : today.toISOString();

  const { data: progress } = await db.from('user_quest_progress')
    .select('id, progress, completed, claimed').eq('user_id', user.id)
    .eq('quest_id', questId).gte('period_start', periodStart)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (!progress) return err('Quest progress not found. Complete the quest first.', req, 400);
  if (!progress.completed) return err(`Quest not yet complete. Progress: ${progress.progress}/${quest.target}`, req, 400);
  if (progress.claimed) return err('You have already claimed this quest reward.', req, 400);

  const { error: claimErr } = await db.from('user_quest_progress')
    .update({ claimed: true, claimed_at: new Date().toISOString() }).eq('id', progress.id);
  if (claimErr) return err('Failed to claim quest. Please try again.', req, 500);

  if (quest.xp_reward > 0) await awardXP(user.id, quest.xp_reward);
  if (Number(quest.coin_reward) > 0) {
    await creditCoins(user.id, Number(quest.coin_reward), 'quest_reward', questId, 'quest', `Quest reward: ${quest.title}`);
  }

  const BADGE_MAP: Record<string, string> = { 'sessions_taught': '5-sessions', 'bounties_won': 'first-win', 'gold_verification': 'gold-teacher', 'portfolio-5': 'portfolio-builder' };
  const badgeSlug = BADGE_MAP[quest.criteria];
  if (badgeSlug) {
    const cat = quest.criteria.includes('session') || quest.criteria.includes('teach') ? 'teach' : quest.criteria.includes('bounty') ? 'bounty' : quest.criteria.includes('gold') ? 'teach' : 'special';
    await db.from('user_badges').upsert({ user_id: user.id, badge_slug: badgeSlug, category: cat }, { onConflict: 'user_id,badge_slug' });
  }

  return ok({ success: true, xp_awarded: quest.xp_reward, coins_awarded: Number(quest.coin_reward), quest_title: quest.title,
    message: `Quest complete! ⚡ +${quest.xp_reward} XP${Number(quest.coin_reward) > 0 ? ` · 🪙 +${quest.coin_reward}` : ''}` }, req);
}

function getWeekStart(): Date {
  const d = new Date(); const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day + (day === 0 ? -6 : 1));
  d.setUTCHours(0, 0, 0, 0); return d;
}
