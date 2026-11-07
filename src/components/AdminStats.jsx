import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadCoachStats, loadInactive, prettyPhone, waLink } from '../lib/coach.js'

const short = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

function Tile({ label, value, note }) {
  return (
    <div className="rounded-lg border border-line bg-ink p-3">
      <p className="text-xs uppercase tracking-wider text-neutral-400">{label}</p>
      <p className="font-display text-3xl tabular-nums text-white">{value}</p>
      {note && <p className="text-xs text-neutral-400">{note}</p>}
    </div>
  )
}

// Посещения по неделям: один ряд — без легенды, подпись в заголовке; значение — по наведению/тапу.
function WeeksChart({ weeks }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(1, ...weeks.map((w) => w.visits))
  const shown = hover ?? weeks.length - 1
  const cur = weeks[shown]
  return (
    <div>
      <p className="mb-2 text-sm text-neutral-300" aria-live="polite">
        Неделя с {short(cur.week_start)}: <b className="text-white tabular-nums">{cur.visits}</b> посещ.,{' '}
        <b className="text-white tabular-nums">{cur.people}</b> чел.
      </p>
      <div className="flex h-36 items-end gap-[2px] border-b border-line" onMouseLeave={() => setHover(null)}>
        {weeks.map((w, i) => (
          <button
            key={w.week_start}
            type="button"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onClick={() => setHover(i)}
            aria-label={`Неделя с ${short(w.week_start)}: ${w.visits} посещений, ${w.people} человек`}
            className="group flex h-full flex-1 items-end"
          >
            <span
              className={`block w-full rounded-t-[4px] ${i === shown ? 'bg-accent' : 'bg-accent/50 group-hover:bg-accent/80'}`}
              style={{ height: `${Math.max(w.visits ? 3 : 0, (w.visits / max) * 100)}%` }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-neutral-500">
        <span>{short(weeks[0].week_start)}</span>
        <span>эта неделя</span>
      </div>
    </div>
  )
}

const comeBackText = (p) =>
  `Привет, ${p.first_name}! Давно не видели тебя на тренировке в Daugavpils Top Team — всё в порядке? ` +
  'Ждём в зале, расписание и запись в приложении app.daugavpilstopteam.lv 💪'

// Вкладка «Статистика»: посещаемость за 12 недель и кто перестал ходить.
export default function AdminStats({ athletes = [] }) {
  const [weeks, setWeeks] = useState(null)
  const [inactive, setInactive] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([loadCoachStats(12), loadInactive(14)])
      .then(([w, i]) => {
        setWeeks(w)
        setInactive(i)
      })
      .catch((e) => setError(e.message.includes('coach_stats') ? 'Выполните supabase/layer34_coach_tools.sql' : e.message))
  }, [])

  if (error) return <p className="rounded-md border border-accent p-3 text-sm text-accent">Статистика: {error}</p>
  if (!weeks) return <p className="card text-neutral-400">Считаем…</p>

  const thisWeek = weeks.at(-1)
  const lastWeek = weeks.at(-2)
  const full = weeks.slice(0, -1) // текущая неделя ещё не закончилась
  const avg = full.length ? Math.round(full.reduce((s, w) => s + w.visits, 0) / full.length) : 0
  const monthAgo = Date.now() - 30 * 864e5
  const newcomers = athletes.filter((a) => new Date(a.created_at).getTime() > monthAgo).length

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Эта неделя" value={thisWeek.visits} note={`${thisWeek.people} чел.`} />
        <Tile label="Прошлая" value={lastWeek?.visits ?? 0} note={`${lastWeek?.people ?? 0} чел.`} />
        <Tile label="В среднем" value={avg} note="посещ. в неделю" />
        <Tile label="Новые" value={newcomers} note="аккаунтов за 30 дн." />
      </div>

      <div className="card">
        <p className="label">Посещения по неделям</p>
        <WeeksChart weeks={weeks} />
      </div>

      <div className="card space-y-2">
        <p className="label">Давно не приходили · {inactive.length}</p>
        <p className="text-xs text-neutral-500">Были 3+ раза, но последние 2 недели не отмечались — риск, что уйдут.</p>
        {inactive.length === 0 ? (
          <p className="text-sm text-neutral-400">Таких нет 👍</p>
        ) : (
          <ul className="divide-y divide-line">
            {inactive.map((p) => (
              <li key={p.profile_id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <Link to={`/admin/athlete/${p.profile_id}`} className="font-semibold hover:text-accent hover:underline">
                    {p.first_name} {p.last_name}
                  </Link>
                  <span className="block text-xs text-neutral-400">
                    последний раз {short(p.last_visit)} · всего {p.visits} трен.
                  </span>
                </span>
                {p.phone && (
                  <a
                    href={waLink(p.phone, comeBackText(p))}
                    target="_blank"
                    rel="noopener"
                    title={prettyPhone(p.phone)}
                    className="rounded border border-emerald-600 px-2 py-1 text-xs text-emerald-400 hover:border-emerald-400"
                  >
                    WhatsApp
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
