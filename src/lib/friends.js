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

/**
 * Слой 31: кто записан на занятия. Возвращает { [sessionId]: { people: [...], hidden: n } }.
 * people — ученики с открытым профилем (имя, фото); hidden — сколько ещё записано без имени.
 */
export async function loadAttendees(sessionIds, { photos = false } = {}) {
  if (!sessionIds.length) return {}
  const rows = must(await supabase.rpc('session_attendees', { p_sessions: sessionIds }))
  const urls = {}
  const paths = photos ? rows.map((r) => r.avatar_url).filter(Boolean) : []
  if (paths.length) {
    const { data } = await supabase.storage.from(AVATARS_BUCKET).createSignedUrls([...new Set(paths)], 3600)
    data?.forEach((d) => d.signedUrl && (urls[d.path] = d.signedUrl))
  }
  const map = {}
  for (const r of rows) {
    const m = (map[r.session_id] ??= { people: [], hidden: 0 })
    if (r.athlete_id) m.people.push({ id: r.athlete_id, first_name: r.first_name, last_name: r.last_name, photo: urls[r.avatar_url] ?? null })
    else m.hidden += r.hidden_count ?? 0
  }
  return map
}

/** «Идут: Анна, Пётр и ещё 2» (без текста, если никого). */
export function attendeesText(a, myId) {
  if (!a) return ''
  const names = a.people.filter((p) => p.id !== myId).map((p) => p.first_name)
  const extra = a.hidden + (names.length > 3 ? names.length - 3 : 0)
  const shown = names.slice(0, 3)
  if (!shown.length && !extra) return ''
  if (!shown.length) return `Идут: ${extra} чел.`
  return `Идут: ${shown.join(', ')}${extra ? ` и ещё ${extra}` : ''}`
}

export const loadFriendInvites = async () => must(await supabase.rpc('my_friend_invites'))

export const answerFriendInvite = async (id, accept) =>
  must(await supabase.rpc('answer_friend_invite', { p_invite: id, p_accept: accept }))

/** Скрыть / показать свой профиль другим ученикам (кроме имени и фото). */
export async function setHideProfile(userId, hide) {
  must(await supabase.from('profiles').update({ hide_profile: hide }).eq('id', userId))
  forgetClubPeople()
}
