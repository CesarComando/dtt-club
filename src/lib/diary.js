// Слой 13: параметры тела (ИМТ), словарь приёмов, мои приёмы, дневник тренировок.
// Доступ ограничен RLS: ученик видит и меняет только своё, тренер читает всё.
import { supabase } from './supabaseClient.js'

const must = ({ data, error }) => {
  if (error) throw error
  return data
}

// ---- Параметры тела (profile_body: закрытая таблица, не profiles) ----
export const loadBody = async (userId) =>
  must(await supabase.from('profile_body').select('height, weight, birth_date').eq('id', userId).maybeSingle())

export const saveBody = async (userId, { height, weight, birth_date }) =>
  must(
    await supabase
      .from('profile_body')
      .upsert({ id: userId, height, weight, birth_date, updated_at: new Date().toISOString() })
      .select('height, weight, birth_date')
      .single(),
  )

/** ИМТ = вес (кг) / рост (м)². null, если данных нет. */
export function bmi(height, weight) {
  if (!height || !weight) return null
  return Math.round((weight / (height / 100) ** 2) * 10) / 10
}

/** Полных лет на сегодня. */
export function ageFrom(birthDate) {
  if (!birthDate) return null
  const b = new Date(birthDate)
  const now = new Date()
  let age = now.getFullYear() - b.getFullYear()
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) age--
  return age
}

// Категории ВОЗ — только для взрослых (18+). У детей ИМТ оценивают по возрастным таблицам.
export function bmiCategory(value, age) {
  if (value == null) return null
  if (age != null && age < 18) return { label: 'До 18 лет оценивается по возрастным таблицам', tone: 'neutral' }
  if (value < 18.5) return { label: 'Ниже нормы', tone: 'warn' }
  if (value < 25) return { label: 'Норма', tone: 'ok' }
  if (value < 30) return { label: 'Выше нормы', tone: 'warn' }
  return { label: 'Значительно выше нормы', tone: 'warn' }
}

// ---- Словарь приёмов и мои приёмы ----
export const loadTechniques = async () =>
  must(await supabase.from('techniques_dictionary').select('id, name, category, discipline').order('category').order('name'))

export const loadLearned = async (userId) => {
  const rows = must(await supabase.from('user_learned_techniques').select('technique_id, status').eq('user_id', userId))
  return Object.fromEntries(rows.map((r) => [r.technique_id, r.status]))
}

/** status: 'learning' | 'mastered' | null (убрать из своих). */
export async function setLearned(userId, techniqueId, status) {
  if (!status) {
    must(await supabase.from('user_learned_techniques').delete().eq('user_id', userId).eq('technique_id', techniqueId))
    return
  }
  must(
    await supabase
      .from('user_learned_techniques')
      .upsert({ user_id: userId, technique_id: techniqueId, status, updated_at: new Date().toISOString() }),
  )
}

// ---- Дневник ----
export const loadDiary = async (userId, limit = 50) =>
  must(
    await supabase
      .from('training_diary')
      .select('id, date, notes, applied_techniques')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit),
  )

export const addDiaryEntry = async ({ date, notes, applied_techniques }) =>
  must(
    await supabase
      .from('training_diary')
      .insert({ date, notes, applied_techniques })
      .select('id, date, notes, applied_techniques')
      .single(),
  )

export const deleteDiaryEntry = async (id) => must(await supabase.from('training_diary').delete().eq('id', id))

// Приёмы подходят направлению ученика (both — видит всё).
export const fitsDiscipline = (t, discipline) =>
  !discipline || discipline === 'both' || t.discipline === 'both' || t.discipline === discipline
