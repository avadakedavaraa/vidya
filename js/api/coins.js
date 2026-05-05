/**
 * js/api/coins.js — Wallet balance, history, stats, and transactions.
 */
import { getSupabase, APIError } from './client.js';

export const coins = {
  async balance() {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('get_coin_balance');
    if (error) throw new APIError(error.message, 500);
    const c = Number(data ?? 0);
    localStorage.setItem('vs_coins', String(c));
    document.querySelectorAll('[data-coin-balance]').forEach(el => { el.textContent = c; });
    return c;
  },

  async history({ type = null, limit = 20, offset = 0 } = {}) {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase.rpc('get_wallet_history', { p_user_id: user.id, p_type: type, p_limit: limit, p_offset: offset });
    if (error) throw new APIError(error.message, 500);
    return data ?? [];
  },

  async getStats() {
    const supabase = getSupabase();
    const userId = localStorage.getItem('vs_user_id');
    if (!userId) return null;
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    try {
      const [monthRes, totalRes, escrowRes] = await Promise.all([
        supabase.from('coin_ledger').select('amount').eq('user_id', userId).gte('created_at', firstDay),
        supabase.from('coin_ledger').select('amount').eq('user_id', userId).gt('amount', 0),
        supabase.from('bookings').select('escrow_amount, released_amount').eq('learner_id', userId).in('status', ['confirmed', 'active'])
      ]);
      let monthEarned = 0, monthSpent = 0;
      (monthRes.data || []).forEach(t => { const amt = Number(t.amount); if (amt > 0) monthEarned += amt; else monthSpent += Math.abs(amt); });
      let totalEarnedEver = 0;
      (totalRes.data || []).forEach(t => { totalEarnedEver += Number(t.amount); });
      let inEscrow = 0;
      (escrowRes.data || []).forEach(b => { inEscrow += (Number(b.escrow_amount) - Number(b.released_amount || 0)); });
      return { monthEarned, monthSpent, inEscrow, totalEarnedEver };
    } catch (err) {
      console.error('getStats failed:', err);
      return { monthEarned: 0, monthSpent: 0, inEscrow: 0, totalEarnedEver: 0 };
    }
  },

  /**
   * Add coins to the current user via the claim_game_reward RPC.
   * Returns the new balance.
   */
  async add(amount, note = 'Game reward') {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('claim_game_reward', {
      p_amount: Number(amount),
      p_lang: 'game',
      p_level: 1,
      p_note: note,
    });
    if (error) throw new APIError(error.message, 500);
    const newBalance = Number(data ?? 0);
    localStorage.setItem('vs_coins', String(newBalance));
    return newBalance;
  },
};

export const transactions = {
  async getAll() {
    const userId = localStorage.getItem('vs_user_id');
    if (!userId) return [];
    const sb = getSupabase();
    const { data, error } = await sb.from('coin_ledger').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw error;
    return data.map(t => {
      let icon = '🪙';
      if (t.type === 'quest_reward') icon = '🎮';
      else if (t.type === 'welcome_bonus') icon = '🎁';
      else if (t.type.includes('session')) icon = '📚';
      else if (t.type.includes('bounty')) icon = '🎯';
      
      return {
        type: t.amount > 0 ? 'plus' : 'minus',
        title: t.note || t.type.replace(/_/g, ' '),
        date: new Date(t.created_at).toLocaleDateString() + ' · ' + new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        amount: Math.abs(t.amount),
        raw_type: t.type,
        icon: icon
      };
    });
  }
};
