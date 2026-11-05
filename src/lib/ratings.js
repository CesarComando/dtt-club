// Слой 14 + 18: оценки партнёров (1–5) по 8 критериям (гигиена — слой 18).
// Кто поставил оценку, видят только автор и тренер; свои средние ученик видит при 3+ оценках.
import { supabase } from './supabaseClient.js'

export const CRITERIA = [
  { key: 'technique', label: 'Техника' },
  { key: 'speed', label: 'Скорость' },
  { key: 'strength', label: 'Сила' },
  { key: 'flexibility', label: 'Гибкость' },
  { key: 'stance', label: 'Стойка' },
  { key: 'armlock', label: 'Болевые' },
  { key: 'choke', label: 'Удушающие' },
  { key: 'hygiene', label: 'Гигиена' },
]
export const MIN_RATINGS = 3

const col = (key) => `${key}_score`
const must = ({ data, error }) => {
  if (error) throw error
  return data
}

/** Ученики клуба, которых можно оценить (без себя и тренера). */
export const loadTeammates = async (myId) =>
  must(
    await supabase
      .from('profiles')
      .select('id, first_name, last_name, discipline')
      .eq('role', 'athlete')
      .neq('id', myId)
      .order('first_name'),
  )

/** Мои выставленные оценки: target_id → { technique: 4, … }. */
export async function loadMyGiven(myId) {
  const rows = must(await supabase.from('peer_ratings').select('*').eq('rater_id', myId))
  return Object.fromEntries(
    rows.map((r) => [r.target_id, Object.fromEntries(CRITERIA.map((c) => [c.key, r[col(c.key)]]))]),
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
