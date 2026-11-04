// Клубная система рангов (APP_PASSPORT §3).
// Только для грепплинга. Ранг растёт автоматически по числу тренировок;
// тренер может назначить ранг вручную (profiles.rank_override), он важнее автоматического.

// 1 год стажа ≈ 90 тренировок (2 раза в неделю × 45 недель сезона).
export const TRAININGS_PER_YEAR = 90

export const RANKS = [
  { id: 1, title: 'Юный падаван', years: 0 },
  { id: 2, title: 'Тролль', years: 1 },
  { id: 3, title: 'Матёрый тролль', years: 3 },
  { id: 4, title: 'Ронин тролль', years: 4 },
  { id: 5, title: 'Старый тролль', years: 7 },
].map((r) => ({ ...r, minTrainings: r.years * TRAININGS_PER_YEAR }))

export const DISCIPLINES = {
  grappling: 'Grappling',
  mma: 'MMA / K1',
  both: 'Grappling + MMA',
}

export const hasRanks = (discipline) => discipline !== 'mma'

// Ранг, который дают тренировки (без учёта ручного).
export function autoRank(trainings) {
  return [...RANKS].reverse().find((r) => trainings >= r.minTrainings) ?? RANKS[0]
}

/**
 * Итоговый ранг спортсмена + прогресс до следующего.
 * manual = true, если ранг назначил тренер (тогда прогресс-бар не показываем).
 */
export function getRank(trainings, rankOverride = null) {
  if (rankOverride) {
    const current = RANKS.find((r) => r.id === rankOverride) ?? RANKS[0]
    return { current, next: RANKS[current.id] ?? null, percent: null, remaining: null, manual: true }
  }

  const current = autoRank(trainings)
  const next = RANKS[current.id] ?? null
  if (!next) return { current, next: null, percent: 100, remaining: 0, manual: false }

  const span = next.minTrainings - current.minTrainings
  const done = trainings - current.minTrainings
  return {
    current,
    next,
    percent: Math.floor((done / span) * 100),
    remaining: next.minTrainings - trainings,
    manual: false,
  }
}
