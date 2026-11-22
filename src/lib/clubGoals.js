// Цель клуба на месяц. Показатель один: среднее число РАЗНЫХ участников в неделю
// за 4 последние полные недели (coach_stats отдаёт по строке на неделю по рижскому времени,
// последняя строка — текущая, ещё не законченная неделя).
import { supabase } from './supabaseClient.js'

const mean = (rows) => rows.reduce((s, r) => s + r.people, 0) / rows.length
const round1 = (x) => Math.round(x * 10) / 10

/** { current, previous, weeks, from, to } или null, если данных мало (нужно 8 полных недель). */
export function weeklyBaseline(rows) {
  const complete = (rows ?? []).slice(0, -1).slice(-8)
  if (complete.length < 8 || complete.some((w) => !Number.isFinite(w.people) || w.people < 0)) return null
  const last4 = complete.slice(4)
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
  return {
    current: round1(mean(last4)),
    previous: round1(mean(complete.slice(0, 4))),
    weeks: last4.map((w) => ({ week: w.week_start, people: w.people })),
    from: last4[0].week_start,
    to: addDays(last4.at(-1).week_start, 6), // по какое число учтены данные
  }
}

/** Неделя, где отметок подозрительно мало: 0 или меньше половины обычного. Похоже на пропущенный учёт. */
export function suspiciousWeek(metrics) {
  if (!metrics) return null
  const vals = metrics.weeks.map((w) => w.people).sort((a, b) => a - b)
  const median = (vals[1] + vals[2]) / 2
  return metrics.weeks.find((w) => w.people === 0 || (median >= 4 && w.people < median / 2)) ?? null
}

export const MONTH_AIM = 'Заполнить свободные места в одной группе Даугавпилса.'

/**
 * Следующий шаг и почему. Порядок: сначала учёт (иначе цифры врут), потом цель достигнута,
 * удержание (люди уходят), набор. Выполненные шаги (done) пропускаются — дальше «сверить итог».
 * Возвращает { id, text, why, vars }.
 */
export function nextStep(metrics, goal) {
  if (!metrics) return { id: 'nodata', text: 'Загрузить статистику посещений.', why: 'Без данных о посещениях шаг выбрать нельзя.' }
  const done = goal?.done ?? []
  const steps = []
  const odd = suspiciousWeek(metrics)
  if (odd) steps.push({ id: 'check:' + odd.week, text: 'Проверить учёт: все ли тренеры отмечали участников в неделю с {week}.',
    why: 'В эту неделю отмечено {n} чел., а обычно около {usual}. Если отметки пропущены, показатель и следующий шаг будут неверными.',
    vars: { week: odd.week, n: odd.people, usual: Math.round(metrics.weeks.map((w) => w.people).sort((a, b) => a - b).slice(1, 3).reduce((s, x) => s + x, 0) / 2) } })
  if (goal?.target) {
    const gap = round1(goal.target - metrics.current)
    if (gap <= 0) steps.push({ id: 'hold', text: 'Цель достигнута. Проверить, держится ли посещаемость ещё четыре недели подряд.',
      why: 'Сейчас в среднем {cur} чел. в неделю при цели {target}.', vars: { cur: metrics.current, target: goal.target } })
    else if (metrics.current < metrics.previous * 0.95) steps.push({ id: 'retain', text: 'Начать с удержания: выяснить, кто перестал ходить, и позвать их на удобное занятие.',
      why: 'За последние 4 недели в среднем {cur} чел., а за 4 недели до этого — {prev}. Вернуть ушедших быстрее, чем набрать новых.', vars: { cur: metrics.current, prev: metrics.previous } })
    else steps.push({ id: 'recruit', text: 'Провести пробную тренировку в группе со свободными местами. Через неделю посчитать, кто вернулся.',
      why: 'До цели не хватает {gap} чел. в неделю. Посещаемость не падает — можно звать новых.', vars: { gap } })
    steps.push({ id: 'review', text: 'Сверить посещаемость с целью. Если разрыв остался — выбрать одно изменение на следующий месяц.',
      why: 'Цикл шагов пройден — пора посмотреть результат.', vars: {} })
  } else if (!odd) {
    steps.push({ id: 'set', text: 'Поставить цель на месяц: сколько разных участников в неделю должно ходить.', why: 'Сейчас в среднем {cur} чел. в неделю.', vars: { cur: metrics.current } })
  }
  return steps.find((s) => !done.includes(s.id)) ?? steps.at(-1)
}

export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`

// ---- Хранение: база (видно на всех устройствах) + копия на этом устройстве (без сети) ----
const LS = (userId, month) => `dtt-club-goal:${userId}:${month}`
const readLocal = (userId, month) => { try { return JSON.parse(localStorage.getItem(LS(userId, month))) } catch { return null } }
const writeLocal = (userId, month, goal) => { try { localStorage.setItem(LS(userId, month), JSON.stringify(goal)); return true } catch { return false } }
const tableMissing = (e) => /club_goals|42P01|PGRST205|PGRST106/.test(`${e?.code} ${e?.message}`)

/** { goal, where: 'server' | 'device' | 'none', note } */
export async function loadGoal(userId, month = monthKey()) {
  const local = readLocal(userId, month)
  const { data, error } = await supabase.from('club_goals').select('*').eq('month', month).maybeSingle()
  if (error) {
    if (tableMissing(error)) return { goal: local, where: local ? 'device' : 'none', note: 'nolayer' }
    return { goal: local, where: local ? 'device' : 'none', note: 'offline' }
  }
  if (local?.pending && (!data || (local.at ?? 0) >= Date.parse(data.updated_at))) {
    // цель меняли без связи, и это изменение новее, чем в базе — досылаем
    const saved = await saveGoal(userId, local, month)
    return { goal: saved.goal, where: saved.where, note: saved.note }
  }
  const goal = data ? { title: data.title, target: data.target, start: data.start_value, done: data.done ?? [], updatedAt: data.updated_at } : null
  if (goal) writeLocal(userId, month, goal)
  return { goal, where: goal ? 'server' : 'none', note: '' }
}

export async function saveGoal(userId, goal, month = monthKey()) {
  const row = { month, title: goal.title ?? '', target: goal.target, start_value: goal.start ?? null, done: goal.done ?? [] }
  const { data, error } = await supabase.from('club_goals').upsert(row).select('*').single()
  if (error) {
    const ok = writeLocal(userId, month, { ...goal, pending: true, at: Date.now() })
    if (!ok) throw new Error('Не удалось сохранить цель ни в базе, ни на устройстве.')
    return { goal, where: 'device', note: tableMissing(error) ? 'nolayer' : 'offline' }
  }
  const saved = { title: data.title, target: data.target, start: data.start_value, done: data.done ?? [], updatedAt: data.updated_at }
  writeLocal(userId, month, saved)
  return { goal: saved, where: 'server', note: '' }
}
