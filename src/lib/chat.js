// Слой 45: друзья и личные сообщения.
// Писать можно только друзьям; переписку видят только двое участников (RLS).
import { useEffect, useState } from 'react'
import { supabase, AVATARS_BUCKET } from './supabaseClient.js'

const must = ({ data, error }) => {
  if (error) throw error
  return data
}

/** Временные ссылки на фото (на 1 час) для списка людей. */
async function withPhotos(list) {
  const paths = list.map((p) => p.avatar_url).filter(Boolean)
  const urls = {}
  if (paths.length) {
    const { data } = await supabase.storage.from(AVATARS_BUCKET).createSignedUrls(paths, 3600)
    data?.forEach((d) => d.signedUrl && (urls[d.path] = d.signedUrl))
  }
  return list.map((p) => ({ ...p, photo: urls[p.avatar_url] ?? null }))
}

export const loadChatPeople = async () => withPhotos(must(await supabase.rpc('chat_people')) ?? [])
export const loadMyFriends = async () => withPhotos(must(await supabase.rpc('my_friends')) ?? [])
export const chatUnread = async () => must(await supabase.rpc('chat_unread')) ?? 0

export const sendFriendRequest = async (to) => must(await supabase.rpc('send_friend_request', { p_to: to }))
export const respondFriendRequest = async (from, accept) =>
  must(await supabase.rpc('respond_friend_request', { p_from: from, p_accept: accept }))
export const removeFriend = async (other) => must(await supabase.rpc('remove_friend', { p_other: other }))

export const sendMessage = async (to, body) => must(await supabase.rpc('send_message', { p_to: to, p_body: body }))
export const markChatRead = async (other) => must(await supabase.rpc('mark_chat_read', { p_other: other }))

/** Последние сообщения с человеком (по возрастанию времени). before — для «показать раньше». */
export async function loadMessages(me, other, { before = null, limit = 50 } = {}) {
  let q = supabase
    .from('messages')
    .select('id, sender, recipient, body, created_at, read_at')
    .or(`and(sender.eq.${me},recipient.eq.${other}),and(sender.eq.${other},recipient.eq.${me})`)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (before) q = q.lt('created_at', before)
  return must(await q).reverse()
}

/**
 * Подписка на всё, что касается меня в чате: новые сообщения, прочтения, заявки в друзья.
 * Возвращает функцию отписки.
 */
export function subscribeChat(me, onChange) {
  if (!supabase || !me) return () => {}
  const ch = supabase
    .channel(`chat:${me}:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `recipient=eq.${me}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `sender=eq.${me}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `addressee=eq.${me}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `requester=eq.${me}` }, onChange)
    .subscribe()
  return () => supabase.removeChannel(ch)
}

/** Значок в меню: непрочитанные сообщения + входящие заявки. */
export function useChatUnread(userId) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!userId) return setN(0)
    let alive = true
    const refresh = () => chatUnread().then((v) => alive && setN(v)).catch(() => {})
    refresh()
    const off = subscribeChat(userId, refresh)
    const onFocus = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('dtt-chat-read', refresh)
    return () => {
      alive = false
      off()
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('dtt-chat-read', refresh)
    }
  }, [userId])
  return n
}

export const fullName = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(' ') || '—'
export const initials = (p) => ((p?.first_name?.[0] ?? '') + (p?.last_name?.[0] ?? '')).toUpperCase() || '?'
