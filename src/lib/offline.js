// Офлайн-режим: последние данные своего аккаунта хранятся на телефоне,
// чтобы кабинет открывался без интернета (в зале, в подвале, в дороге).
// Хранится только своё (ключ с id аккаунта); при выходе всё стирается.
import { useSyncExternalStore } from 'react'
import { t } from './i18n.jsx'

const PREFIX = 'dtt-cache:'
let currentUser = null // id вошедшего — часть ключа, чтобы на общем телефоне не смешивались аккаунты
let staleSince = null // с какого времени показываем сохранённые данные (null — всё свежее)
const listeners = new Set()
const emit = () => listeners.forEach((l) => l())

export const setCacheUser = (id) => {
  currentUser = id ?? null
}

/** Ошибка сети: нет интернета, сервер не отвечает (iPhone пишет «Load failed», Chrome — «Failed to fetch»). */
export function isNetworkError(e) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const text = `${e?.name ?? ''} ${e?.message ?? ''} ${e?.details ?? ''}`
  return /Failed to fetch|Load failed|NetworkError|Network request failed|AuthRetryableFetchError|fetch failed/i.test(text)
}

/** Понятный текст вместо «Load failed» / «Failed to fetch». */
export const friendlyError = (e) => (isNetworkError(e) ? t('Нет связи с сервером — проверьте интернет и попробуйте ещё раз.') : e?.message ?? String(e))

export function saveCache(key, data, user = currentUser) {
  if (!user) return
  try {
    localStorage.setItem(`${PREFIX}${user}:${key}`, JSON.stringify({ at: Date.now(), data }))
  } catch {
    /* память браузера переполнена или запрещена — работаем без кэша */
  }
}

export function readCache(key, user = currentUser) {
  if (!user) return null
  try {
    return JSON.parse(localStorage.getItem(`${PREFIX}${user}:${key}`))
  } catch {
    return null
  }
}

function markStale(at) {
  if (!staleSince || at < staleSince) {
    staleSince = at
    emit()
  }
}

/** Загрузить и сохранить; без сети — отдать сохранённое (и показать плашку «офлайн»). */
export async function cached(key, fn) {
  try {
    const data = await fn()
    saveCache(key, data)
    return data
  } catch (e) {
    if (isNetworkError(e)) {
      const c = readCache(key)
      if (c) {
        markStale(c.at)
        return c.data
      }
    }
    throw e
  }
}

/** Выход из аккаунта: стираем всё сохранённое на телефоне. */
export function clearCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    /* нет доступа к памяти */
  }
  staleSince = null
  emit()
}

// --- Есть ли интернет -------------------------------------------------
const subscribe = (cb) => {
  listeners.add(cb)
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

/** { online, staleSince } — для плашки «Нет интернета». */
export function useOffline() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
  const stale = useSyncExternalStore(subscribe, () => staleSince, () => null)
  return { online, staleSince: stale }
}
