// Слой 13: параметры тела (ИМТ), словарь приёмов, мои приёмы, дневник тренировок.
// Доступ ограничен RLS: ученик видит и меняет только своё, тренер читает всё.
import { supabase } from './supabaseClient.js'
import { t } from './i18n.jsx'

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
  if (age != null && age < 18) return { label: t('До 18 лет оценивается по возрастным таблицам'), tone: 'neutral' }
  if (value < 18.5) return { label: t('Ниже нормы'), tone: 'warn' }
  if (value < 25) return { label: t('Норма'), tone: 'ok' }
  if (value < 30) return { label: t('Выше нормы'), tone: 'warn' }
  return { label: t('Значительно выше нормы'), tone: 'warn' }
}

// ---- Словарь приёмов и мои приёмы ----
export const loadTechniques = async () =>
  must(await supabase.from('techniques_dictionary').select('id, name, category, discipline').order('category').order('name'))

/** { [technique_id]: { status, confirmed } } — confirmed: тренер подтвердил «в спарринге». */
export const loadLearned = async (userId) => {
  const rows = must(
    await supabase.from('user_learned_techniques').select('technique_id, status, confirmed_at').eq('user_id', userId),
  )
  return Object.fromEntries(rows.map((r) => [r.technique_id, { status: r.status, confirmed: Boolean(r.confirmed_at) }]))
}

// Слой 40: три уровня. mastered = «получается в спарринге», подтверждает тренер.
export const LEVELS = ['learning', 'drill', 'mastered']
export const LEVEL = {
  learning: { icon: '◔', label: t('Изучаю'), cls: 'border-white/50 text-white' },
  drill: { icon: '◑', label: t('На дрилле'), cls: 'border-amber-400/70 bg-amber-400/10 text-white' },
  mastered: { icon: '✓', label: t('В спарринге'), cls: 'border-accent bg-accent/15 text-white' },
}
/** Нажатие по приёму: нет → изучаю → на дрилле → в спарринге → убрать. */
export const nextLevel = (s) => (s == null ? 'learning' : s === 'learning' ? 'drill' : s === 'drill' ? 'mastered' : null)

/** Действующая тема (club_focus) для направления ученика. */
export async function loadFocus(discipline) {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Riga' })
  const rows = must(
    await supabase.from('club_focus').select('*').lte('starts_on', day).gte('ends_on', day).order('starts_on', { ascending: false }),
  )
  return rows.find((f) => f.discipline === 'both' || !discipline || discipline === 'both' || f.discipline === discipline) ?? null
}
export const loadFocusProgress = async (focusId) =>
  must(await supabase.rpc('focus_progress', { p_focus: focusId })) ?? []
export const saveFocus = async (id, patch) =>
  must(await supabase.from('club_focus').update(patch).eq('id', id).select('*').single())

// Тренер: подтверждения «в спарринге».
export const loadPendingConfirmations = async () => must(await supabase.rpc('pending_technique_confirmations')) ?? []
export const confirmTechnique = async (userId, techniqueId, ok) =>
  must(await supabase.rpc('confirm_technique', { p_user: userId, p_technique: techniqueId, p_ok: ok }))

/** status: 'learning' | 'drill' | 'mastered' | null (убрать из своих). */
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
