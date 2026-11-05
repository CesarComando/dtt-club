// Слой 29: ученики клуба для других учеников (club_people) и приглашения внутри приложения.
// Чужие профили напрямую не читаются: только имя и фото (и ранг/направление, если профиль не скрыт).
import { supabase, AVATARS_BUCKET } from './supabaseClient.js'

const must = ({ data, error }) => {
  if (error) throw error
  return data
}

let peopleCache = null
/** Ученики клуба (без детских аккаунтов). С фото — временные ссылки на 1 час. */
export async function loadClubPeople({ photos = false } = {}) {
  if (!peopleCache) peopleCache = must(await supabase.rpc('club_people'))
  if (!photos) return peopleCache
  const paths = peopleCache.map((p) => p.avatar_url).filter(Boolean)
  const urls = {}
  if (paths.length) {
    const { data } = await supabase.storage.from(AVATARS_BUCKET).createSignedUrls(paths, 3600)
    data?.forEach((d) => d.signedUrl && (urls[d.path] = d.signedUrl))
  }
  return peopleCache.map((p) => ({ ...p, photo: urls[p.avatar_url] ?? null }))
}
export const forgetClubPeople = () => {
  peopleCache = null
}

export const inviteFriend = async (sessionId, toId) =>
  must(await supabase.rpc('invite_friend', { p_session: sessionId, p_to: toId }))

export const loadFriendInvites = async () => must(await supabase.rpc('my_friend_invites'))

export const answerFriendInvite = async (id, accept) =>
  must(await supabase.rpc('answer_friend_invite', { p_invite: id, p_accept: accept }))

/** Скрыть / показать свой профиль другим ученикам (кроме имени и фото). */
export async function setHideProfile(userId, hide) {
  must(await supabase.from('profiles').update({ hide_profile: hide }).eq('id', userId))
  forgetClubPeople()
}
