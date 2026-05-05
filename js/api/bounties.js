/**
 * js/api/bounties.js — Bounty posting, bidding, and encryption.
 */
import { getSupabase, edgeFn, APIError } from './client.js';

export const bounties = {
  async list({ category = null, status = 'open', search = null, sort = 'newest', limit = 20, offset = 0 } = {}) {
    const supabase = getSupabase();
    let query = supabase.from('bounties').select(`id, title, description, category, tags, coin_reward, deadline_at, status, bid_count, created_at, poster:poster_id(id, name, avatar_color)`).eq('status', status || 'open').order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (category) query = query.eq('category', category);
    if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    const { data, error } = await query;
    if (error) throw new APIError(error.message, 500);
    return data ?? [];
  },

  async post(payload) { return edgeFn('post-bounty', payload); },
  async submitBid(payload) { return edgeFn('submit-bid', payload); },

  async encryptProposal(proposalText, posterPublicKey) {
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const enc = new TextEncoder();
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(proposalText));
    const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    return { encrypted_proposal: toB64(cipherBuf), encryption_iv: toB64(iv.buffer) };
  },

  async getAll() {
    const list = await bounties.list().catch(() => []);
    return list.map(b => ({
      id: b.id, title: b.title, desc: b.description, category: b.category, tags: b.tags, reward: b.coin_reward, bids: b.bid_count || 0,
      deadline: new Date(b.deadline_at).toLocaleDateString(),
      poster: b.poster?.name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '??',
      posterBg: b.poster?.avatar_color || 'var(--indigo)', status: b.status === 'open' ? 'new' : b.status
    }));
  },
};
