// Слой 53: события клуба — соревнования, опен маты, семинары. Видят все, пишет главный тренер.
import { supabase } from './supabaseClient.js'
import { locale, t } from './i18n.jsx'

export const KINDS = {
  competition: t('Соревнования'),
  open_mat: t('Опен мат'),
  seminar: t('Семинар'),
  other: t('Другое'),
}
export const KIND_ICON = { competition: '🏆', open_mat: '🤼', seminar: '🎓', other: '📅' }

const must = ({ data, error }) => {
  if (error) throw error
  return data
}

const COLS = 'id, title, kind, starts_on, ends_on, start_time, place, description'
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Riga' })

/** Ближайшие (ещё не закончились), по дате. */
export const loadUpcomingEvents = async (limit = 50) =>
  must(
    await supabase
      .from('club_events')
      .select(COLS)
      .or(`starts_on.gte.${today()},ends_on.gte.${today()}`)
      .order('starts_on')
      .order('start_time', { nullsFirst: true })
      .limit(limit),
  ) ?? []

/** Прошедшие, сначала свежие. */
export const loadPastEvents = async (limit = 30) =>
  (must(
    await supabase.from('club_events').select(COLS).lt('starts_on', today()).order('starts_on', { ascending: false }).limit(limit * 2),
  ) ?? [])
    .filter((e) => !e.ends_on || e.ends_on < today())
    .slice(0, limit)

const clean = (e) => ({
  title: e.title.trim(),
  kind: e.kind,
  starts_on: e.starts_on,
  ends_on: e.ends_on || null,
  start_time: e.start_time || null,
  place: e.place?.trim() || null,
  description: e.description?.trim() || null,
})

export const saveEvent = async (e) =>
  e.id
    ? must(await supabase.from('club_events').update(clean(e)).eq('id', e.id))
    : must(await supabase.from('club_events').insert(clean(e)))

export const deleteEvent = async (id) => must(await supabase.from('club_events').delete().eq('id', id))

const day = (d, opts) => new Date(`${d}T12:00:00`).toLocaleDateString(locale(), opts)

/** «12 дек.» или «12–14 дек.» + время. */
export const eventWhen = (e) => {
  const opts = { day: 'numeric', month: 'short' }
  let s = day(e.starts_on, { ...opts, weekday: 'short' })
  if (e.ends_on && e.ends_on !== e.starts_on) s += ` – ${day(e.ends_on, opts)}`
  if (e.start_time) s += ` · ${e.start_time.slice(0, 5)}`
  return s
}
