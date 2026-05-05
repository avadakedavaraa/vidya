/**
 * api.js — Vidyasetu Frontend API Layer (Entry Point)
 * ─────────────────────────────────────────────────────────────
 * Imports all modular services from js/api/ and assembles them
 * into the global window.VS namespace.
 *
 * Requires (loaded before this script in each HTML page):
 *   <script src="config.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
 *
 * Usage:
 *   const teachers = await VS.teachers.list({ category: 'programming' });
 *   const balance  = await VS.coins.balance();
 *   await VS.auth.sendOTP(email, 'login');
 */

import { getSupabase, APIError } from './js/api/client.js';
window.getSupabase = getSupabase;
import { auth } from './js/api/auth.js';
import { coins, transactions } from './js/api/coins.js';
import { teachers } from './js/api/teachers.js';
import { sessions } from './js/api/sessions.js';
import { bounties } from './js/api/bounties.js';
import { quests } from './js/api/quests.js';
import { profile, leaderboard } from './js/api/profile.js';
import { dm, chat } from './js/api/messages.js';
import { matchmaking } from './js/api/matchmaking.js';
import { verify, mcqs } from './js/api/verify.js';
import { campus } from './js/api/campus.js';
import { ui } from './js/api/ui.js';

// ─── Assemble the global VS namespace ────────────────────────
window.VS = {
  auth,
  coins,
  transactions,
  teachers,
  sessions,
  bounties,
  quests,
  leaderboard,
  profile,
  matchmaking,
  verify,
  mcqs,
  dm,
  chat,
  campus,
  ui,

  // ─── Coin realtime watcher ─────────────────────────────
  watchCoins(onUpdate) {
    const sb = getSupabase();
    return sb
      .channel('coins:' + localStorage.getItem('vs_user_id'))
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'coin_ledger',
        filter: `user_id=eq.${localStorage.getItem('vs_user_id')}`,
      }, async (payload) => {
        const newBalance = await window.VS.coins.balance();
        if (onUpdate) onUpdate(newBalance, payload.new);
      })
      .subscribe();
  },

  // ─── VS.api compatibility helpers ──────────────────────
  // Called by 05/06/07/10/14 pages. Delegates to the real VS.* namespaces.
  api: {
    async getTeacher(id) {
      if (!id) return null;
      try {
        const sb = getSupabase();
        const { data, error } = await sb.from('users')
          .select('id,name,college,avatar_color,bio,xp,level,last_active_at,skills(*)')
          .eq('id', id).eq('is_banned', false).single();
        if (error || !data) throw new Error('not found');
        const primarySkill = (data.skills || []).find(s => s.is_teaching) || data.skills?.[0] || {};
        const name = data.name || 'Unknown';
        
        // Fetch real stats
        const stats = await window.VS.teachers.getStats(id).catch(() => ({ avgRating: 0, totalSessions: 0, reviewsCount: 0 }));

        return {
          id: data.id, name,
          initials: name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(),
          color: data.avatar_color || '#5B45E0', college: data.college || 'Verified Student',
          bio: data.bio || '', xp: data.xp || 0, level: data.level || 1,
          rating: stats.avgRating > 0 ? stats.avgRating : 0,
          reviews: stats.reviewsCount,
          reviews_count: stats.reviewsCount,
          sessions: stats.totalSessions,
          completion_rate: 100,
          online: new Date(data.last_active_at) > new Date(Date.now() - 15 * 60000),
          tier: primarySkill.tier || 'bronze',
          teaches: (data.skills || []).filter(s => s.is_teaching).map(s => s.name),
          wants: [], rate: primarySkill.coin_rate || 1.0, category: primarySkill.category || 'other',
        };
      } catch (e) {
        const list = await window.VS.teachers.getAll().catch(() => []);
        return list.find(t => t.id === id) || null;
      }
    },

    async getCurrentUser() {
      try {
        const sb = getSupabase();
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return window.VS.auth.currentUser();
        const { data: p } = await sb.from('users').select('*').eq('id', user.id).single();
        if (!p) return window.VS.auth.currentUser();
        const c = await window.VS.coins.balance().catch(() => parseInt(localStorage.getItem('vs_coins') || '0'));
        const name = p.name || 'User';
        return {
          id: p.id, name,
          initials: name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(),
          email: user.email, coins: c, xp: p.xp || 0, level: p.level || 1,
          college: p.college || '', avatar_color: p.avatar_color || '#5B45E0',
          game_progress: p.game_progress || {},
        };
      } catch (e) { return window.VS.auth.currentUser(); }
    },
  },
};

// ─── Auto-update UI on load ──────────────────────────────────
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    if (window.VS && window.VS.ui) {
      window.VS.ui.updateSidebar();
    }
  });
}
