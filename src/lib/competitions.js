// Слой 41: мои соревнования — турнир, место и бои с разбором.
// Видят сам ученик и главный тренер (RLS).
import { supabase } from './supabaseClient.js'
import { t } from './i18n.jsx'

const must = ({ data, error }) => {
  if (error) throw error
  return data
}

export const COMP_DISCIPLINES = {
  grappling: t('Грэпплинг'),
  bjj: t('BJJ'),
  mma: 'MMA',
  k1: 'K1',
  kickboxing: t('Кикбоксинг'),
  pankration: t('Панкратион'),
  wrestling: t('Борьба'),
  other: t('Другое'),
}
export const RESULTS = {
  win: { label: t('Победа'), cls: 'text-emerald-400' },
  loss: { label: t('Поражение'), cls: 'text-accent' },
  draw: { label: t('Ничья'), cls: 'text-neutral-300' },
}
export const METHODS = {
  submission: t('Сабмишен (болевой / удушение)'),
  points: t('По очкам'),
  decision: t('Решение судей'),
  ko: t('Нокаут'),
  tko: t('Технический нокаут'),
  advantage: t('По преимуществу'),
  dq: t('Дисквалификация'),
  other: t('Другое'),
}
export const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' }

export const emptyFight = () => ({ opponent: '', opponent_club: '', result: 'win', method: 'submission', technique: '', time: '', review: '' })

export const loadCompetitions = async (userId) =>
  must(
    await supabase
      .from('competitions')
      .select('id, date, title, city, discipline, category, place, fights, notes')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .order('id', { ascending: false }),
  )

const clean = (c) => ({
  date: c.date,
  title: c.title.trim(),
  city: c.city?.trim() || null,
  discipline: c.discipline,
  category: c.category?.trim() || null,
  place: c.place ? Number(c.place) : null,
  notes: c.notes?.trim() || null,
  fights: (c.fights ?? [])
    .map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])))
    .filter((f) => f.opponent || f.technique || f.review),
  updated_at: new Date().toISOString(),
})

export async function saveCompetition(userId, c) {
  const row = clean(c)
  if (c.id) return must(await supabase.from('competitions').update(row).eq('id', c.id).select('*').single())
  return must(await supabase.from('competitions').insert({ ...row, user_id: userId }).select('*').single())
}

export const deleteCompetition = async (id) => must(await supabase.from('competitions').delete().eq('id', id))

/** Медали и баланс боёв для плиток. */
export function competitionStats(list) {
  const fights = list.flatMap((c) => c.fights ?? [])
  return {
    medals: list.filter((c) => c.place && c.place <= 3).length,
    gold: list.filter((c) => c.place === 1).length,
    wins: fights.filter((f) => f.result === 'win').length,
    losses: fights.filter((f) => f.result === 'loss').length,
  }
}
