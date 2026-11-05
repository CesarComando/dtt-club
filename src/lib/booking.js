// Запись на тренировки (слой 8). Расписание и лимиты — в базе
// (training_slots / training_sessions), лимит проверяет сервер в book_session.
import { supabase } from './supabaseClient.js'

export async function loadUpcoming(days = 7) {
  const { data, error } = await supabase.rpc('upcoming_sessions', { p_days: days })
  if (error) throw error
  return data
}

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
  const s = new Date(iso).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const hm = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
export const sessionTime = (s) => `${hm(s.starts_at)}–${hm(s.ends_at)}`

export const seatsText = (s) => (s.capacity ? `${s.booked} / ${s.capacity} мест` : `${s.booked} записано`)
export const isFull = (s) => s.capacity != null && s.booked >= s.capacity
