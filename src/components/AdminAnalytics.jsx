import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { formatPrice } from '../lib/payments.js'
import { t, locale } from '../lib/i18n.jsx'
import { CATEGORIES } from './AdminBudget.jsx'

// Бюджет → «Аналитика» (слой 50): встроенный бизнес-аналитик для главного тренера.
// Все цифры считает функция club_analytics() в базе (только is_admin). Здесь — графики и выводы простыми словами.

const INCOME = '#10b981' // как плитка «Доходы» в бюджете
const EXPENSE = '#e10600' // как плитка «Расходы»
const BAR = '#a3a3a3' // одиночные ряды — нейтрально, без «значения» цвета

const DOW = () => [t('Пн'), t('Вт'), t('Ср'), t('Чт'), t('Пт'), t('Сб'), t('Вс')]
const DOW_FULL = () => [t('понедельник'), t('вторник'), t('среда'), t('четверг'), t('пятница'), t('суббота'), t('воскресенье')]
const DISCIPLINE = { grappling: 'Grappling', mma: 'MMA / K1', both: 'Grappling + MMA', none: t('Направление не указано') }

const monthShort = (m) => new Date(`${m.slice(0, 7)}-15T12:00:00`).toLocaleDateString(locale(), { month: 'short' }).replace('.', '')
const monthLong = (m) => new Date(`${m.slice(0, 7)}-15T12:00:00`).toLocaleDateString(locale(), { month: 'long' })
const monthYearTitle = (m) => {
  const s = new Date(`${m.slice(0, 7)}-15T12:00:00`).toLocaleDateString(locale(), { month: 'long', year: 'numeric' }).replace(' г.', '')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
// «1 марта 2026» — с числом месяц стоит в нужном падеже («с 1 марта»)
const monthYear = (m) => new Date(`${m.slice(0, 7)}-01T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }).replace(' г.', '')
const euro = (c) => formatPrice(Math.round(c / 100) * 100)
const pct = (x) => `${Math.round(x * 100)}%`
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

export default function AdminAnalytics() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [pick, setPick] = useState(null) // выбранный месяц в «Платящие ученики» (по умолчанию — последний)

  useEffect(() => {
    supabase.rpc('club_analytics').then(({ data: d, error: e }) => (e ? setError(e.message) : setData(d)))
  }, [])

  const a = useMemo(() => (data ? analyse(data) : null), [data])

  if (error) return <p className="rounded-md border border-accent p-3 text-sm text-accent">{t('Аналитика: {error}', { error })}</p>
  if (!a) return <p className="card text-neutral-400">{t('Считаем…')}</p>

  return (
    <div className="space-y-4">
      <section className="card space-y-2">
        <h2 className="text-xl">{t('Выводы')}</h2>
        <ul className="space-y-2 text-sm">
          {a.insights.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true" className="shrink-0">{s.icon}</span>
              <span>{s.text}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-neutral-500">
          {t('Оплаты по месяцам — с {from}, отметки посещений — с {att}. Чем дольше учёт, тем точнее выводы.', {
            from: monthYear(a.months[0]?.m ?? data.today), att: new Date(`${data.attendance_since}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'long' }),
          })}
        </p>
      </section>

      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Tile value={euro(a.avgIncome)} label={t('Доход в месяц, в среднем')} />
        <Tile value={Math.round(a.avgPayers)} label={t('Платящих в месяц')} />
        <Tile value={a.retention == null ? '—' : pct(a.retention)} label={t('Остаются на след. месяц')} />
        <Tile value={euro(a.perPayer)} label={t('Средний чек ученика за месяц')} />
      </div>

      <Chart title={t('Доходы и расходы по месяцам')} legend={[[INCOME, t('Доходы')], [EXPENSE, t('Расходы')]]}>
        <Bars
          rows={a.months.map((m) => ({
            label: monthShort(m.m),
            values: [m.income, m.expenses],
            tip: `${monthLong(m.m)}: ${t('доход')} ${formatPrice(m.income)}, ${t('расходы')} ${formatPrice(m.expenses)}`,
            partial: m.partial,
          }))}
          colors={[INCOME, EXPENSE]}
          format={euro}
        />
      </Chart>

      <Chart title={t('Платящие ученики по месяцам')} note={t('Под столбиком: + новые / − не заплатили после прошлого месяца. Нажмите на месяц — покажем имена.')}>
        <Bars
          selected={pick}
          onSelect={setPick}
          rows={a.months.map((m) => ({
            label: monthShort(m.m),
            sub: `+${m.new_payers} −${m.lost}`,
            values: [m.payers],
            tip: `${monthLong(m.m)}: ${t('платили {n}, новых {new}, пропало {lost}', { n: m.payers, new: m.new_payers, lost: m.lost })}`,
            partial: m.partial,
          }))}
          colors={[BAR]}
          format={(v) => v}
        />
        <MonthPeople m={a.months[pick ?? a.months.length - 1]} />
      </Chart>

      <Chart title={t('Посещения по дням недели')} note={t('Сколько человек в среднем приходит на одну тренировку')}>
        {a.sessionsTotal < 4 ? (
          <Empty />
        ) : (
          <Bars
            rows={a.weekday.map((d) => ({
              label: DOW()[d.dow - 1],
              values: [d.avg],
              tip: `${DOW_FULL()[d.dow - 1]}: ${t('{v} посещений за {s} трен.', { v: d.visits, s: d.sessions })}`,
            }))}
            colors={[BAR]}
            format={(v) => (v ? v.toFixed(1).replace('.0', '') : '0')}
          />
        )}
      </Chart>

      <Chart title={t('Заполненность групп')} note={t('Пришло от вместимости зала на проведённых тренировках')}>
        {a.groups.length === 0 ? (
          <Empty />
        ) : (
          <div className="space-y-2">
            {a.groups.map((g) => (
              <HBar key={g.title} label={g.title} share={g.fill} text={`${pct(g.fill)} · ${t('{v} чел. / {s} трен.', { v: g.visits, s: g.sessions })}`} />
            ))}
          </div>
        )}
      </Chart>

      <Chart title={t('Когда приходят: день и час')} note={t('Темнее — больше людей')}>
        {a.heat.cells.length === 0 ? <Empty /> : <Heat heat={a.heat} />}
      </Chart>

      <Chart title={t('Из чего доход')} note={a.since}>
        <div className="space-y-2">
          {a.mix.map((x) => (
            <HBar key={x.label} label={x.label} share={x.share} text={`${euro(x.sum)} · ${pct(x.share)}`} />
          ))}
        </div>
      </Chart>

      <Chart title={t('Доход по направлениям')} note={a.since}>
        <div className="space-y-2">
          {a.disciplines.map((x) => (
            <HBar key={x.label} label={x.label} share={x.share} text={`${euro(x.sum)} · ${pct(x.share)}`} />
          ))}
        </div>
      </Chart>

      <Chart title={t('Доходы · от кого')} note={t('{since}: 10 учеников, принёсших больше всего', { since: a.since })}>
        {(data.top_payers ?? []).length === 0 ? (
          <p className="text-sm text-neutral-400">—</p>
        ) : (
          <div className="space-y-2">
            {data.top_payers.map((p) => (
              <HBar key={p.name} label={p.name} share={p.total / data.top_payers[0].total} text={`${euro(p.total)} · ${t('{n} опл.', { n: p.n })}`} />
            ))}
          </div>
        )}
      </Chart>

      <Chart title={t('Расходы · куда')} note={a.since}>
        {a.expenses.length === 0 ? (
          <p className="text-sm text-neutral-400">—</p>
        ) : (
          <div className="space-y-2">
            {a.expenses.map((x) => (
              <HBar key={x.key} label={x.label} share={x.share} text={`${euro(x.sum)} · ${pct(x.share)}`} />
            ))}
          </div>
        )}
      </Chart>

      <section className="card space-y-2">
        <h2 className="text-xl">{t('Пропали')}</h2>
        <p className="text-xs text-neutral-500">{t('Платили хотя бы 2 месяца, но больше 35 дней ни оплаты, ни посещения. Стоит написать им.')}</p>
        {data.lost.length === 0 ? (
          <p className="text-sm text-neutral-400">{t('Никто не пропал 👍')}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {data.lost.map((l) => (
              <li key={`${l.name}-${l.last}`} className="flex justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">{l.name} <span className="text-neutral-500">· {DISCIPLINE[l.discipline] ?? ''}</span></span>
                <span className="shrink-0 text-neutral-400">
                  {t('был {date}', { date: new Date(`${l.last}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) })}
                  {' · '}{t('{n} мес.', { n: l.months })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/* ---------- расчёты и выводы ---------- */

function analyse(d) {
  const thisMonth = d.today.slice(0, 7)
  // Графики — с первого месяца, где есть оплаты учеников (до этого был только годовой итог одной суммой).
  const first = d.months.findIndex((m) => m.payers > 0)
  const months = (first < 0 ? d.months.slice(-1) : d.months.slice(first)).map((m) => ({ ...m, partial: m.m.startsWith(thisMonth) }))
  const full = months.filter((m) => !m.partial)

  const avgIncome = avg(full.map((m) => m.income))
  const avgPayers = avg(full.map((m) => m.payers))
  const perPayer = avg(full.filter((m) => m.payers).map((m) => m.income / m.payers))
  const stays = months.slice(1).map((m, i) => (months[i].payers ? (months[i].payers - m.lost) / months[i].payers : null)).filter((x) => x != null)
  const retention = stays.length ? avg(stays) : null

  const weekday = d.weekday.slice(0, 6).map((w) => ({ ...w, avg: w.sessions ? w.visits / w.sessions : 0 }))
  const sessionsTotal = d.weekday.reduce((s, w) => s + w.sessions, 0)
  const groups = d.groups
    .filter((g) => g.sessions > 0)
    .map((g) => ({ ...g, fill: g.capacity ? g.visits / g.capacity : 0 }))
    .sort((x, y) => y.fill - x.fill)

  const hours = [...new Set(d.heat.map((h) => h.hour))].sort((x, y) => x - y)
  const heat = { hours, cells: d.heat, max: Math.max(1, ...d.heat.map((h) => h.visits)) }

  const MIX = { membership: t('Абонементы'), training: t('Разовые тренировки'), individual: t('Индивидуальные'), app: t('Оплаты в приложении'), other: t('Прочее (донаты, форма, наличные от тренера)') }
  const mixTotal = Object.values(d.mix).reduce((s, x) => s + x, 0) || 1
  const mix = Object.entries(MIX)
    .map(([k, label]) => ({ key: k, label, sum: d.mix[k] ?? 0, share: (d.mix[k] ?? 0) / mixTotal }))
    .filter((x) => x.sum > 0)
    .sort((x, y) => y.sum - x.sum)

  const byDisc = {}
  d.disciplines.forEach((x) => (byDisc[x.discipline] = (byDisc[x.discipline] ?? 0) + x.income))
  const discTotal = Object.values(byDisc).reduce((s, x) => s + x, 0) || 1
  const disciplines = Object.entries(byDisc)
    .map(([k, sum]) => ({ label: DISCIPLINE[k] ?? k, sum, share: sum / discTotal }))
    .sort((x, y) => y.sum - x.sum)

  /* выводы простыми словами */
  const insights = []
  if (full.length >= 3) {
    const best = full.reduce((x, y) => (y.income > x.income ? y : x))
    const worst = full.reduce((x, y) => (y.income < x.income ? y : x))
    insights.push({ icon: '📅', text: t('Сезонность: лучший месяц — {best} ({bi}), самый слабый — {worst} ({wi}).', { best: monthLong(best.m), bi: euro(best.income), worst: monthLong(worst.m), wi: euro(worst.income) }) })
  }
  if (full.length >= 6) {
    const last3 = avg(full.slice(-3).map((m) => m.income))
    const prev3 = avg(full.slice(-6, -3).map((m) => m.income))
    if (prev3) {
      const ch = (last3 - prev3) / prev3
      insights.push({
        icon: ch >= 0 ? '📈' : '📉',
        text: t('Последние 3 месяца доход {dir} на {p} по сравнению с тремя до них ({a} против {b} в месяц).', { dir: ch >= 0 ? t('вырос') : t('упал'), p: pct(Math.abs(ch)), a: euro(last3), b: euro(prev3) }),
      })
    }
  }
  const minus = full.filter((m) => m.expenses > m.income)
  if (full.length) {
    insights.push({
      icon: minus.length ? '⚠️' : '✅',
      text: minus.length
        ? t('В минусе было {n} мес. из {all}: {list}.', { n: minus.length, all: full.length, list: minus.map((m) => monthLong(m.m)).join(', ') })
        : t('Все {all} мес. доход покрывал расходы.', { all: full.length }),
    })
  }
  if (retention != null) {
    insights.push({ icon: '🔁', text: t('В среднем {p} платящих учеников платят и в следующем месяце. Каждый месяц теряется около {n} чел.', { p: pct(retention), n: Math.round(avg(months.slice(1).map((m) => m.lost))) }) })
  }
  const single = mix.find((x) => x.key === 'training')
  const memb = mix.find((x) => x.key === 'membership')
  if (single && memb && single.sum > memb.sum) {
    insights.push({ icon: '💡', text: t('Разовые тренировки приносят больше, чем абонементы ({s} против {m}). Тех, кто ходит часто, выгодно перевести на абонемент — доход станет стабильнее.', { s: pct(single.share), m: pct(memb.share) }) })
  }
  // Пока какая-то группа не отмечается в приложении, сравнение дней недели обманчиво — не делаем вывод.
  const silent = groups.some((g) => g.visits === 0)
  const withSessions = weekday.filter((w) => w.sessions >= 2)
  if (!silent && withSessions.length >= 2) {
    const top = withSessions.reduce((x, y) => (y.avg > x.avg ? y : x))
    const low = withSessions.reduce((x, y) => (y.avg < x.avg ? y : x))
    if (top.avg > low.avg) {
      insights.push({ icon: '🗓️', text: t('Больше всего людей на тренировке — {top} (в среднем {a}), меньше всего — {low} ({b}).', { top: DOW_FULL()[top.dow - 1], a: top.avg.toFixed(1), low: DOW_FULL()[low.dow - 1], b: low.avg.toFixed(1) }) })
    }
  }
  if (groups.length >= 2) {
    const g0 = groups[0]
    const gl = groups[groups.length - 1]
    insights.push({ icon: '👥', text: t('Самая заполненная группа — {a} ({p}), самая пустая — {b} ({q}).', { a: g0.title, p: pct(g0.fill), b: gl.title, q: pct(gl.fill) }) })
    if (gl.visits === 0) insights.push({ icon: '📲', text: t('В группе «{g}» пока ни одной отметки в приложении — просите учеников отмечаться по QR, иначе аналитика посещений неполная.', { g: gl.title }) })
  }
  if (d.lost.length) insights.push({ icon: '📞', text: t('Пропали больше месяца назад ({n}): {names}. Стоит написать им.', { n: d.lost.length, names: d.lost.map((l) => l.name).join(', ') }) })
  if (!insights.length) insights.push({ icon: 'ℹ️', text: t('Пока мало данных для выводов. Они появятся через пару месяцев учёта.') })

  const since = t('С {from}', { from: monthYear(months[0]?.m ?? d.today) })
  const exTotal = Object.values(d.expense_cats ?? {}).reduce((s, x) => s + x, 0) || 1
  const expenses = Object.entries(d.expense_cats ?? {})
    .map(([k, sum]) => ({ key: k, label: CATEGORIES[k] ?? k, sum, share: sum / exTotal }))
    .sort((x, y) => y.sum - x.sum)
  return { since, expenses, months, avgIncome, avgPayers, perPayer, retention, weekday, sessionsTotal, groups, heat, mix, disciplines, insights }
}

/* ---------- графики (простые, без библиотек) ---------- */

function Tile({ value, label }) {
  return (
    <div className="card px-2 py-3">
      <p className="font-display text-xl sm:text-2xl">{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-neutral-400">{label}</p>
    </div>
  )
}

function Chart({ title, note, legend, children }) {
  return (
    <section className="card space-y-3">
      <div>
        <h2 className="text-xl">{title}</h2>
        {note && <p className="text-xs text-neutral-500">{note}</p>}
        {legend && (
          <div className="mt-1 flex gap-4 text-xs text-neutral-400">
            {legend.map(([c, l]) => (
              <span key={l} className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
                {l}
              </span>
            ))}
          </div>
        )}
      </div>
      {children}
    </section>
  )
}

function Empty() {
  return <p className="text-sm text-neutral-400">{t('Пока мало отметок посещений — график появится, когда ученики начнут отмечаться на тренировках.')}</p>
}

// Вертикальные столбики: один или несколько рядов в каждой колонке. Наведение/нажатие — подсказка.
function Bars({ rows, colors, format, selected, onSelect }) {
  const [active, setActive] = useState(null)
  const shown = active ?? selected
  const max = Math.max(1, ...rows.flatMap((r) => r.values))
  const H = 140
  return (
    <div>
      <p className="mb-1 h-4 truncate text-xs text-neutral-300">{shown != null ? rows[shown].tip : ' '}</p>
      <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height: H + 34 }} onMouseLeave={() => setActive(null)}>
        {rows.map((r, i) => (
          <button
            key={i}
            type="button"
            title={r.tip}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onClick={() => (onSelect ? onSelect(i) : setActive(i))}
            className={`flex min-w-[28px] flex-1 flex-col items-center justify-end rounded ${active === i ? 'bg-white/5' : selected === i ? 'bg-white/10 ring-1 ring-line' : ''}`}
            style={{ height: H + 34 }}
          >
            <div className="flex items-end gap-[2px]" style={{ height: H }}>
              {r.values.map((v, k) => (
                <div
                  key={k}
                  className="w-2.5 rounded-t sm:w-3.5"
                  style={{ height: Math.max(v ? 2 : 0, (v / max) * H), background: colors[k], opacity: r.partial ? 0.45 : 1 }}
                />
              ))}
            </div>
            <span className={`mt-1 text-[10px] ${r.partial ? 'text-neutral-500' : 'text-neutral-400'}`}>{r.label}</span>
            <span className="text-[9px] text-neutral-500">{r.sub ?? (r.values.length === 1 ? format(r.values[0]) : '')}</span>
          </button>
        ))}
      </div>
      {rows.some((r) => r.partial) && <p className="text-[11px] text-neutral-500">{t('Бледный столбик — текущий месяц, он ещё не закончился.')}</p>}
    </div>
  )
}

// Имена под графиком платящих: кто пришёл и кто не заплатил после прошлого месяца.
function MonthPeople({ m }) {
  if (!m) return null
  const Line = ({ title, names }) => (
    <p>
      <span className="text-neutral-400">{title} ({names.length}): </span>
      {names.length ? names.join(', ') : '—'}
    </p>
  )
  return (
    <div className="space-y-1 rounded-md border border-line p-3 text-sm">
      <p className="font-semibold">{monthYearTitle(m.m)}</p>
      <Line title={t('Не заплатили после прошлого месяца')} names={m.lost_names ?? []} />
      <Line title={t('Новые')} names={m.new_names ?? []} />
    </div>
  )
}

function HBar({ label, share, text }) {
  return (
    <div className="text-sm">
      <div className="flex justify-between gap-3">
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-neutral-400">{text}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-line">
        <div className="h-2 rounded-full" style={{ width: `${Math.min(100, Math.max(share > 0 ? 2 : 0, share * 100))}%`, background: BAR }} />
      </div>
    </div>
  )
}

function Heat({ heat }) {
  const days = [1, 2, 3, 4, 5, 6]
  const cell = (dow, hour) => heat.cells.find((c) => c.dow === dow && c.hour === hour)?.visits ?? 0
  return (
    <div className="overflow-x-auto">
      <table className="text-center text-[11px]">
        <thead>
          <tr>
            <th />
            {heat.hours.map((h) => (
              <th key={h} className="px-1 font-normal text-neutral-500">{`${h}:00`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((dow) => (
            <tr key={dow}>
              <th className="pr-2 text-left font-normal text-neutral-400">{DOW()[dow - 1]}</th>
              {heat.hours.map((h) => {
                const v = cell(dow, h)
                return (
                  <td key={h} className="p-0.5">
                    <div
                      title={`${DOW_FULL()[dow - 1]} ${h}:00 — ${v}`}
                      className="flex h-7 w-11 items-center justify-center rounded"
                      style={{ background: v ? `rgba(225, 6, 0, ${0.15 + 0.85 * (v / heat.max)})` : '#1f1f1f' }}
                    >
                      {v || ''}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
