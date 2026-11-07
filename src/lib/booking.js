// Запись на тренировки (слой 8). Расписание и лимиты — в базе
// (training_slots / training_sessions), лимит проверяет сервер в book_session.
import { supabase } from './supabaseClient.js'
import { cached } from './offline.js'
import { t, tData, locale } from './i18n.jsx'

// Без интернета — последнее сохранённое расписание (offline.js).
export const loadUpcoming = (days = 7) =>
  cached(`upcoming:${days}`, async () => {
    const { data, error } = await supabase.rpc('upcoming_sessions', { p_days: days })
    if (error) throw error
    return data
  })

export async function bookSession(id) {
  const { data, error } = await supabase.rpc('book_session', { p_session: id })
  if (error) throw error
  return data
}

export async function cancelBooking(id, athleteId = null) {
  const { data, error } = await supabase.rpc('cancel_booking', { p_session: id, p_athlete: athleteId })
  if (error) throw error
  return data
}

export async function setSessionVenue(id, venueId) {
  const { data, error } = await supabase.rpc('set_session_venue', { p_session: id, p_venue: venueId })
  if (error) throw error
  return data
}

const TZ = 'Europe/Riga'

// «Вт, 10 нояб.»
export const sessionDay = (iso) => {
  const s = new Date(iso).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const hm = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: TZ })
export const sessionTime = (s) => `${hm(s.starts_at)}–${hm(s.ends_at)}`

export const seatsText = (s) => (s.capacity ? t('{booked} / {capacity} мест', { booked: s.booked, capacity: s.capacity }) : t('{n} записано', { n: s.booked }))
export const isFull = (s) => s.capacity != null && s.booked >= s.capacity

// Слой 12: «Позвать друга» — ссылка-приглашение на конкретное занятие.
export async function createInvite(sessionId) {
  const { data, error } = await supabase.rpc('create_invite', { p_session: sessionId })
  if (error) throw error
  return data
}

export async function inviteInfo(token) {
  const { data, error } = await supabase.rpc('invite_info', { p_token: token })
  if (error) throw error
  return data?.[0] ?? null
}

export async function acceptInvite(token) {
  const { data, error } = await supabase.rpc('accept_invite', { p_token: token })
  if (error) throw error
  return data
}

export const inviteUrl = (token) => `${window.location.href.split('#')[0]}#/invite/${token}`

// Отправить приглашение: системное «Поделиться» (WhatsApp и т.п.), иначе — копия в буфер.
// Возвращает 'shared' | 'copied' | 'cancelled'.
export async function shareInvite(session) {
  const url = inviteUrl(await createInvite(session.id))
  const text = t('Пойдём со мной на тренировку! {title}, {day} {time}. Первая тренировка бесплатно. Записаться:', {
    title: tData(session.title),
    day: sessionDay(session.starts_at),
    time: sessionTime(session),
  })
  if (navigator.share) {
    try {
      await navigator.share({ title: t('Тренировка в Daugavpils Top Team'), text, url })
      return 'shared'
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled'
    }
  }
  await navigator.clipboard.writeText(`${text} ${url}`)
  return 'copied'
}
