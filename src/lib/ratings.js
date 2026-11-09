// Слой 14 + 18 + 39: оценки партнёров 1–10 (с сотыми: 9.76) по 8 критериям (гигиена — слой 18).
// Рейтинг клуба (слой 39): средний балл по 7 боевым критериям, без гигиены.
// Кто поставил оценку, видят только автор и тренер; свои средние ученик видит при 3+ оценках.
import { supabase } from './supabaseClient.js'
import { loadClubPeople } from './friends.js'
import { t, locale } from './i18n.jsx'

export const CRITERIA = [
  { key: 'technique', label: t('Техника') },
  { key: 'speed', label: t('Скорость') },
  { key: 'strength', label: t('Сила') },
  { key: 'flexibility', label: t('Гибкость') },
  { key: 'stance', label: t('Стойка') },
  { key: 'armlock', label: t('Болевые') },
  { key: 'choke', label: t('Удушающие') },
  { key: 'hygiene', label: t('Гигиена') },
]
export const MIN_RATINGS = 3
export const MAX_SCORE = 10

/** 9.5 → «9,5», 9.76 → «9,76», 9 → «9» (по языку приложения). */
export const fmtScore = (v) =>
  v == null ? '—' : Number(v).toLocaleString(locale(), { minimumFractionDigits: 0, maximumFractionDigits: 2 })

/** Рейтинг клуба по направлению: 'mma' | 'grappling'. */
export async function loadLeaderboard(discipline) {
  return must(await supabase.rpc('peer_leaderboard', { p_discipline: discipline })) ?? []
}

const col = (key) => `${key}_score`
const must = ({ data, error }) => {
  if (error) throw error
  return data
}

/** Ученики клуба, которых можно оценить (без себя и тренера). */
// Чужие профили — только через club_people() (слой 29).
export const loadTeammates = async (myId) => (await loadClubPeople()).filter((p) => p.id !== myId)

/** Мои выставленные оценки: target_id → { technique: 4, … }. */
export async function loadMyGiven(myId) {
  const rows = must(await supabase.from('peer_ratings').select('*').eq('rater_id', myId))
  return Object.fromEntries(
    rows.map((r) => [r.target_id, Object.fromEntries(CRITERIA.map((c) => [c.key, r[col(c.key)] == null ? null : Number(r[col(c.key)])]))]),
  )
}

export async function saveRating(myId, targetId, scores) {
  const row = { rater_id: myId, target_id: targetId, updated_at: new Date().toISOString() }
  CRITERIA.forEach((c) => (row[col(c.key)] = scores[c.key]))
  must(await supabase.from('peer_ratings').upsert(row))
}

export const deleteRating = async (myId, targetId) =>
  must(await supabase.from('peer_ratings').delete().eq('rater_id', myId).eq('target_id', targetId))

/** Мои средние (или ученика — для тренера). */
export async function loadSummary(targetId = null) {
  const rows = must(await supabase.rpc('peer_rating_summary', { p_target: targetId }))
  return rows?.[0] ?? { ratings: 0 }
}
