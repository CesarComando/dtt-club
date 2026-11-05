// Раздел, в который вошёл ученик: Grappling или MMA/K1 (выбирается на странице входа).
// Хранится только в этом браузере. Влияет на то, какие тренировки показаны первыми/в списке,
// но не на права: что ученику доступно, решает сервер (направление и cross_training).
import { useSyncExternalStore } from 'react'

const KEY = 'dtt-section'
export const SECTIONS = { grappling: 'Grappling', mma: 'MMA / K1' }
const listeners = new Set()

export function getSection() {
  try {
    const v = localStorage.getItem(KEY)
    return v in SECTIONS ? v : null
  } catch {
    return null
  }
}

export function setSection(value) {
  try {
    if (value) localStorage.setItem(KEY, value)
    else localStorage.removeItem(KEY)
  } catch {
    /* приватный режим */
  }
  listeners.forEach((fn) => fn())
}

export const useSection = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getSection,
    () => null,
  )

/** Может ли ученик ходить в оба направления (тогда раздел переключается). */
export const seesBoth = (profile) =>
  Boolean(profile) && (profile.role !== 'athlete' || profile.discipline === 'both' || profile.cross_training)

/** Какой раздел показывать: выбранный, если он доступен, иначе основное направление. */
export function activeSection(profile, chosen) {
  if (!profile) return chosen
  if (seesBoth(profile)) return chosen ?? (profile.discipline in SECTIONS ? profile.discipline : null)
  return profile.discipline in SECTIONS ? profile.discipline : chosen
}
