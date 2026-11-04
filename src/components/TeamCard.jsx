import { WEEK_DAYS } from '../data/club.js'

// Сегодняшний день в формате 'Пн'…'Вс' (getDay(): 0 = воскресенье).
const TODAY = WEEK_DAYS[(new Date().getDay() + 6) % 7]

export default function TeamCard({ team }) {
  const { name, discipline, prices, classes } = team
  const activeDays = new Set(classes.flatMap((c) => c.days))

  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-line bg-panel">
      {/* Шапка */}
      <header className="relative border-b border-line p-5">
        <span className="absolute inset-y-0 left-0 w-1 bg-accent" />
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">{discipline}</p>
        <h3 className="mt-1 text-2xl leading-tight">{name}</h3>
      </header>

      {/* Дни недели, в которые есть тренировки */}
      <div className="grid grid-cols-7 gap-1 px-5 pt-5">
        {WEEK_DAYS.map((d) => (
          <span
            key={d}
            className={`rounded py-1.5 text-center text-xs font-semibold uppercase ${
              activeDays.has(d) ? 'bg-white text-ink' : 'bg-ink text-neutral-600'
            } ${d === TODAY ? 'ring-2 ring-accent' : ''}`}
          >
            {d}
          </span>
        ))}
      </div>

      {/* Расписание */}
      <ul className="flex-1 divide-y divide-line px-5 py-2">
        {classes.map((c, i) => {
          const isToday = c.days.includes(TODAY)
          return (
            <li key={i} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="flex items-center gap-2 font-semibold">
                  {c.title}
                  {isToday && (
                    <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                      Сегодня
                    </span>
                  )}
                </p>
                <p className="text-sm text-neutral-400">{c.days.join(' · ')}</p>
              </div>
              <span className="font-display text-lg tabular-nums">{c.time}</span>
            </li>
          )
        })}
      </ul>

      {/* Цены */}
      <footer className="grid grid-cols-2 border-t border-line">
        <div className="p-5">
          <p className="label">Абонемент</p>
          <p className="font-display text-4xl">
            {prices.monthly}€<span className="text-base text-neutral-400">/мес</span>
          </p>
        </div>
        <div className="border-l border-line p-5">
          <p className="label">Разовая</p>
          <p className="font-display text-4xl">{prices.single}€</p>
        </div>
      </footer>
    </article>
  )
}
