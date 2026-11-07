// Очередь действий тренера без интернета: отметки «+1», отмены и оплаты наличными.
// Действие сохраняется на телефоне и уходит на сервер, как только появится сеть.
// У каждого действия свой id — повторная отправка не задвоит отметку или оплату.
import { useSyncExternalStore } from 'react'
import { supabase } from './supabaseClient.js'
import { isNetworkError } from './offline.js'

const KEY = 'dtt-outbox'
const listeners = new Set()
let items = load()
let failed = [] // не принятые сервером (например, нет прав) — показываем тренеру
let flushing = false

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? []
  } catch {
    return []
  }
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    /* нет памяти — очередь живёт до закрытия вкладки */
  }
  snapshot = { items, failed, flushing }
  listeners.forEach((l) => l())
}
let snapshot = { items, failed, flushing }

/**
 * Добавить действие. type:
 *  'attendance' { athlete }            — +1 тренировка (время — когда нажали)
 *  'undo'       { athlete }            — отмена отметки
 *  'member_payment' { row }            — оплата в CRM (club_members → member_payments)
 *  'cash'       { athlete, product }   — наличные за аккаунт (record_cash_payment)
 */
export function enqueue(type, args, label, uid) {
  const item = { id: crypto.randomUUID(), type, args, label, uid, at: new Date().toISOString() }
  items = [...items, item]
  persist()
  return item
}

/** Убрать ещё не отправленное (например, «+1» отменили, пока не было сети). */
export function dequeue(id) {
  items = items.filter((i) => i.id !== id)
  persist()
}

export const pendingFor = (athleteId) => items.filter((i) => i.args?.athlete === athleteId)

/** Сколько «+1» / «−1» по ученику ещё ждут отправки (чтобы счётчики на экране были верными). */
export function pendingDelta(uid) {
  const d = {}
  for (const i of items) {
    if (uid && i.uid && i.uid !== uid) continue
    if (i.type === 'attendance') d[i.args.athlete] = (d[i.args.athlete] ?? 0) + 1
    if (i.type === 'undo') d[i.args.athlete] = (d[i.args.athlete] ?? 0) - 1
  }
  return d
}

async function send(item) {
  const { type, args } = item
  if (type === 'attendance') {
    let res = await supabase.rpc('mark_attendance_at', { p_athlete: args.athlete, p_at: item.at, p_client_id: item.id })
    // Слой 37 ещё не выполнен — обычная отметка (время будет «сейчас»)
    if (res.error && /mark_attendance_at|PGRST202|42883/.test(`${res.error.code} ${res.error.message}`)) {
      res = await supabase.rpc('mark_attendance', { p_athlete: args.athlete })
    }
    return res.error
  }
  if (type === 'undo') return (await supabase.rpc('undo_attendance', { p_athlete: args.athlete })).error
  if (type === 'member_payment') {
    const { error } = await supabase.from('member_payments').insert(args.row)
    return error?.code === '23505' ? null : error // уже записано (повторная отправка) — это успех
  }
  if (type === 'cash') return (await supabase.rpc('record_cash_payment', { p_athlete: args.athlete, p_product: args.product })).error
  return null
}

/** Отправить всё по порядку. Без сети — остановиться и ждать. */
export async function flush(uid) {
  if (flushing || !items.length || (typeof navigator !== 'undefined' && !navigator.onLine)) return
  flushing = true
  persist()
  try {
    for (const item of [...items]) {
      if (item.uid && uid && item.uid !== uid) continue // чужая очередь (на телефоне вошёл другой) — не трогаем
      let error
      try {
        error = await send(item)
      } catch (e) {
        error = e
      }
      if (error && isNetworkError(error)) break // сеть снова пропала — попробуем позже
      items = items.filter((i) => i.id !== item.id)
      if (error) failed = [...failed, { ...item, error: error.message ?? String(error) }]
      persist()
    }
  } finally {
    flushing = false
    persist()
  }
}

export const clearFailed = () => {
  failed = []
  persist()
}

const subscribe = (cb) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** { items, failed, flushing } — для плашки «Ждут отправки». */
export const useOutbox = () => useSyncExternalStore(subscribe, () => snapshot, () => snapshot)

/** Запустить автоотправку: при появлении сети, при возврате в приложение и раз в 30 с. */
export function startOutbox(getUid) {
  const run = () => flush(getUid())
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && run())
  setInterval(() => items.length && run(), 30000)
  run()
}
