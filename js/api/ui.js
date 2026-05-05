/**
 * js/api/ui.js — Sidebar, badge, and XP bar UI management.
 */
import { getSupabase } from './client.js';

export const ui = {
  async updateSidebar() {
    let name = localStorage.getItem('vs_user_name') || 'User';
    let coins = localStorage.getItem('vs_coins') || '0';
    let xp = localStorage.getItem('vs_user_xp') || '0';
    let level = localStorage.getItem('vs_user_level') || '1';
    let initials = name !== 'User' ? name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'U';
    // Apply immediately from localStorage for instant display
    this._applySidebarUI(name, initials, coins, xp, level);
    try {
      const userId = localStorage.getItem('vs_user_id');
      if (userId) {
        const sb = getSupabase();
        // Fetch profile and real coin balance in parallel
        const [profileRes, balanceRes] = await Promise.all([
          sb.from('users').select('name, xp, level').eq('id', userId).single(),
          sb.rpc('get_coin_balance'),
        ]);
        if (profileRes.data) {
          const p = profileRes.data;
          name = p.name || name;
          xp = String(p.xp || 0);
          level = String(p.level || 1);
          initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        }
        if (balanceRes.data !== null && balanceRes.data !== undefined) {
          coins = String(Number(balanceRes.data));
          localStorage.setItem('vs_coins', coins);
        }
        this._applySidebarUI(name, initials, coins, xp, level);
      }
    } catch (err) { console.warn('Sidebar background sync failed:', err); }
  },

  _applySidebarUI(name, initials, coins, xp, level) {
    document.querySelectorAll('.sb-avatar, .xph-avatar, .user-menu .avatar').forEach(el => el.textContent = initials);
    document.querySelectorAll('.sb-name, .xph-name, .user-menu .uname').forEach(el => el.textContent = name);
    const coinCount = document.getElementById('sb-coin-count') || document.getElementById('coin-count');
    if (coinCount) coinCount.textContent = coins;
    const sbCoin = document.querySelector('.sb-coin');
    if (sbCoin && !coinCount) sbCoin.innerHTML = `🪙 ${coins} coins`;
    document.querySelectorAll('.xph-level').forEach(el => el.textContent = `Level ${level || Math.floor((parseInt(xp)||0)/500)+1}`);
    document.querySelectorAll('.xph-xp').forEach(xpEl => {
      const xpNum = parseInt(xp) || 0;
      const nextXp = Math.ceil(xpNum / 500) * 500 || 500;
      xpEl.textContent = `${xpNum} / ${nextXp} XP to Level ${Math.floor(xpNum / 500) + 1}`;
    });
    document.querySelectorAll('.xph-fill').forEach(bar => {
      const xpNum = parseInt(xp) || 0;
      bar.style.width = ((xpNum % 500) / 500 * 100) + '%';
    });
    this.updateBadges();
  },

  async updateBadges() {
    const sb = getSupabase();
    const userId = localStorage.getItem('vs_user_id');
    const { count: bCount } = await sb.from('bounties').select('id', { count: 'exact', head: true }).eq('status', 'open');
    document.querySelectorAll('a[href="09_bounty.html"] .badge, a[href="09_bounty.html"] .bdg').forEach(el => el.textContent = bCount || 0);
    if (userId) {
      const { count: sCount } = await sb.from('bookings').select('id', { count: 'exact', head: true }).in('status', ['pending', 'confirmed', 'active']).or(`learner_id.eq.${userId},teacher_id.eq.${userId}`);
      document.querySelectorAll('a[href="11_my_sessions.html"] .badge, a[href="11_my_sessions.html"] .bdg').forEach(el => el.textContent = sCount || 0);
      const p = await window.VS.profile.get();
      if (p && p.college_id) {
        const { count: cCount } = await sb.from('campus_requests').select('id', { count: 'exact', head: true }).eq('status', 'open').eq('college_id', p.college_id);
        document.querySelectorAll('a[href="15_campus_collab.html"] .badge, #sb-campus-badge').forEach(el => el.textContent = cCount || 0);
      }
      const { count: dmCount } = await sb.from('direct_messages').select('id', { count: 'exact', head: true }).eq('receiver_id', userId).eq('is_read', false);
      document.querySelectorAll('a[href="16_messages.html"] .badge, #sb-unread-count, #sb-unread-count-top').forEach(el => { el.textContent = dmCount || 0; el.style.display = dmCount > 0 ? 'block' : 'none'; });
    }
  }
};
