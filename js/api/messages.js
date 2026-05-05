/**
 * js/api/messages.js — Direct messages and booking-scoped chat.
 */
import { getSupabase, APIError } from './client.js';

export const dm = {
  async send(receiverId, content) {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new APIError('Not authenticated', 401);
    if (receiverId === user.id) throw new APIError('Cannot message yourself', 400);
    const { error } = await supabase.from('direct_messages').insert({ sender_id: user.id, receiver_id: receiverId, content: content.trim() });
    if (error) throw new APIError(error.message, 500);
  },

  async list(peerId, limit = 50) {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new APIError('Not authenticated', 401);
    const { data, error } = await supabase.from('direct_messages').select('id, sender_id, receiver_id, content, msg_type, is_read, created_at').or(`and(sender_id.eq.${user.id},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${user.id})`).order('created_at', { ascending: true }).limit(limit);
    if (error) throw new APIError(error.message, 500);
    return data ?? [];
  },

  async conversations() {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new APIError('Not authenticated', 401);
    const { data, error } = await supabase.from('direct_messages').select('id, sender_id, receiver_id, content, created_at, is_read').or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`).order('created_at', { ascending: false }).limit(200);
    if (error) throw new APIError(error.message, 500);
    if (!data || !data.length) return [];
    const convMap = {};
    for (const msg of data) {
      const peerId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
      if (!convMap[peerId]) convMap[peerId] = { peerId, lastMessage: msg.content, lastAt: msg.created_at, unread: 0 };
      if (!msg.is_read && msg.receiver_id === user.id) convMap[peerId].unread++;
    }
    const peerIds = Object.keys(convMap);
    if (peerIds.length) {
      const { data: peers } = await supabase.from('users').select('id, name, avatar_color').in('id', peerIds);
      if (peers) peers.forEach(p => { if (convMap[p.id]) { convMap[p.id].name = p.name; convMap[p.id].color = p.avatar_color; } });
    }
    return Object.values(convMap).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  },

  subscribe(peerId, onMessage) {
    const supabase = getSupabase();
    const userId = localStorage.getItem('vs_user_id');
    return supabase.channel(`dm:${[userId, peerId].sort().join('-')}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `receiver_id=eq.${userId}` }, (payload) => { if (payload.new.sender_id === peerId) onMessage(payload.new); }).subscribe();
  },

  unsubscribe(channel) { if (channel) getSupabase().removeChannel(channel); },

  async markRead(peerId) {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('direct_messages').update({ is_read: true }).eq('sender_id', peerId).eq('receiver_id', user.id).eq('is_read', false);
  },
};

export const chat = {
  async send(bookingId, content, msgType = 'text') {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new APIError('Not authenticated', 401);
    const { error } = await supabase.from('chat_messages').insert({ booking_id: bookingId, sender_id: user.id, content, msg_type: msgType });
    if (error) throw new APIError(error.message, 500);
  },

  async history(bookingId, limit = 50) {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('chat_messages').select('id, sender_id, content, msg_type, file_url, created_at').eq('booking_id', bookingId).eq('is_deleted', false).order('created_at', { ascending: true }).limit(limit);
    if (error) throw new APIError(error.message, 500);
    return data ?? [];
  },

  subscribe(bookingId, onMessage) {
    const supabase = getSupabase();
    return supabase.channel(`chat:${bookingId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `booking_id=eq.${bookingId}` }, (payload) => onMessage(payload.new)).subscribe();
  },

  unsubscribe(channel) { if (channel) getSupabase().removeChannel(channel); },
};
