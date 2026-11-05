import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, AVATARS_BUCKET } from '../lib/supabaseClient.js'
import { getRank, hasRanks, autoRank, RANKS, DISCIPLINES } from '../lib/ranks.js'
import { LIVE_STATUSES } from '../lib/payments.js'
import AdminSessions from '../components/AdminSessions.jsx'
import AdminDebtors, { CashPayment, DeleteAthlete } from '../components/AdminDebtors.jsx'
import CheckinQR from '../components/CheckinQR.jsx'
import AdminMembers from '../components/AdminMembers.jsx'

// CRM тренера (Dainis Miglāns): список учеников + отметка посещений.
// Сюда пускает только <AdminRoute>. Изменения идут через SQL-функции
// mark_attendance / undo_attendance, которые сами проверяют роль admin.

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

const shortDate = (iso) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

// Статус оплаты ученика для CRM: абонемент (подписка) + разовые за 30 дней.
function PaymentBadge({ billing }) {
  const sub = billing?.membership
  const singles = billing?.singles ?? 0
  let text = 'Не оплачен'
  let cls = 'border-line text-neutral-500'
  if (sub?.status === 'past_due') {
    text = 'Долг по абонементу'
    cls = 'border-accent text-accent'
  } else if (sub) {
    text = `Оплачен до ${sub.current_period_end ? shortDate(sub.current_period_end) : '—'}`
    cls = 'border-emerald-600 text-emerald-400'
  } else if (singles) {
    text = `Разовые: ${singles} за 30 дн.`
    cls = 'border-neutral-500 text-neutral-300'
  }
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}>
      {text}
      {billing?.sponsor && <span className="text-accent"> · ♥</span>}
    </span>
  )
}

const formatPhone = (p) => (p?.startsWith('371') && p.length === 11 ? `+371 ${p.slice(3, 7)} ${p.slice(7)}` : p ? `+${p}` : '')

export default function Admin() {
  const [athletes, setAthletes] = useState([])
  const [today, setToday] = useState({}) // athlete_id → сколько отметок сегодня
  const [billing, setBilling] = useState({}) // athlete_id → { membership, singles, sponsor }
  const [pending, setPending] = useState({}) // athlete_id → true, пока идёт запрос
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [reloadKey, setReloadKey] = useState(0) // перечитать список должников

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [profilesRes, contactsRes, attendanceRes, subsRes, paysRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, first_name, last_name, avatar_url, trainings_count, role, discipline, rank_override, is_sponsor')
        .neq('role', 'admin')
        .order('last_name'),
      supabase.from('profile_contacts').select('id, phone'),
      supabase.from('attendance').select('athlete_id').gte('created_at', startOfToday()),
      supabase
        .from('subscriptions')
        .select('user_id, status, current_period_end, product:payment_products(kind)')
        .in('status', LIVE_STATUSES),
      supabase
        .from('payments')
        .select('user_id, method, period_end, created_at, product:payment_products(kind)')
        .eq('status', 'paid')
        .or(`created_at.gte.${new Date(Date.now() - 30 * 864e5).toISOString()},period_end.gt.${new Date().toISOString()}`),
    ])
    const firstError = profilesRes.error || contactsRes.error || attendanceRes.error
    if (firstError) {
      setError('Не удалось загрузить учеников: ' + firstError.message)
      setLoading(false)
      return
    }

    // Подписанные ссылки на селфи одним запросом (бакет приватный).
    const paths = profilesRes.data.map((p) => p.avatar_url).filter(Boolean)
    const urls = {}
    if (paths.length) {
      const { data } = await supabase.storage.from(AVATARS_BUCKET).createSignedUrls(paths, 3600)
      data?.forEach((d) => d.signedUrl && (urls[d.path] = d.signedUrl))
    }
    const phones = Object.fromEntries(contactsRes.data.map((c) => [c.id, c.phone]))

    setAthletes(
      profilesRes.data.map((p) => ({ ...p, phone: phones[p.id], photo: urls[p.avatar_url] ?? null })),
    )
    const counts = {}
    attendanceRes.data.forEach((a) => (counts[a.athlete_id] = (counts[a.athlete_id] ?? 0) + 1))
    setToday(counts)

    // Оплата: если слой 7 ещё не выполнен в базе — просто не показываем статусы.
    const bill = {}
    const entry = (id) => (bill[id] ??= { membership: null, singles: 0, sponsor: false })
    subsRes.data?.forEach((s) => {
      if (s.product?.kind === 'membership') entry(s.user_id).membership = s
      if (s.product?.kind === 'support') entry(s.user_id).sponsor = true
    })
    const monthAgo = Date.now() - 30 * 864e5
    paysRes.data?.forEach((p) => {
      if (p.product?.kind === 'single' && new Date(p.created_at).getTime() > monthAgo) entry(p.user_id).singles++
      // Абонемент наличными: «оплачен до» — самая поздняя дата.
      if (p.method === 'cash' && p.period_end && new Date(p.period_end) > new Date()) {
        const e = entry(p.user_id)
        if (!e.membership || (e.membership.status === 'cash' && p.period_end > e.membership.current_period_end)) {
          if (!e.membership) e.membership = { status: 'cash', current_period_end: p.period_end }
          else e.membership.current_period_end = p.period_end
        }
      }
    })
    profilesRes.data.forEach((p) => p.is_sponsor && (entry(p.id).sponsor = true))
    setBilling(subsRes.error ? {} : bill)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Оптимистичное обновление: UI меняется сразу, при ошибке откатываем.
  // Сколько запросов +1/отмены сейчас в пути для каждого ученика.
  // Кнопка не блокируется: каждое нажатие засчитывается (5 быстрых нажатий = +5),
  // а когда все запросы вернулись, сверяем счётчик с базой.
  const inflight = useRef({})

  const syncCount = async (id) => {
    const { data } = await supabase.from('profiles').select('trainings_count').eq('id', id).single()
    if (data && !inflight.current[id]) {
      setAthletes((list) => list.map((a) => (a.id === id ? { ...a, trainings_count: data.trainings_count } : a)))
    }
  }

  // Оптимистичное обновление: UI меняется сразу, при ошибке откатываем именно это нажатие.
  const change = async (athlete, delta) => {
    const id = athlete.id
    const fn = delta > 0 ? 'mark_attendance' : 'undo_attendance'
    const bump = (d) => {
      setAthletes((list) =>
        list.map((a) => (a.id === id ? { ...a, trainings_count: Math.max(0, a.trainings_count + d) } : a)),
      )
      setToday((t) => ({ ...t, [id]: Math.max(0, (t[id] ?? 0) + d) }))
    }

    setError('')
    inflight.current[id] = (inflight.current[id] ?? 0) + 1
    bump(delta)

    const { data: newCount, error: rpcError } = await supabase.rpc(fn, { p_athlete: id })
    inflight.current[id] -= 1

    if (rpcError) {
      bump(-delta)
      setError(rpcError.message)
    } else if (delta > 0 && hasRanks(athlete.discipline)) {
      // Новый ранг — ровно на том нажатии, где счётчик перешёл порог.
      const rankNow = getRank(newCount, athlete.rank_override).current
      if (rankNow.id > getRank(newCount - 1, athlete.rank_override).current.id) {
        setNotice(`🏆 ${athlete.first_name} ${athlete.last_name} получает ранг «${rankNow.title}»!`)
      }
    }
    if (inflight.current[id] === 0) syncCount(id)
  }

  // Тренер меняет направление и/или ручной ранг (null = автоматический).
  const saveSettings = async (athlete, patch) => {
    const next = { discipline: athlete.discipline, rank_override: athlete.rank_override, ...patch }
    setError('')
    setNotice('')
    setPending((p) => ({ ...p, [athlete.id]: true }))
    setAthletes((list) => list.map((a) => (a.id === athlete.id ? { ...a, ...next } : a)))

    const { error: rpcError } = await supabase.rpc('set_athlete_settings', {
      p_athlete: athlete.id,
      p_discipline: next.discipline,
      p_rank_override: next.rank_override,
    })
    if (rpcError) {
      setAthletes((list) =>
        list.map((a) =>
          a.id === athlete.id ? { ...a, discipline: athlete.discipline, rank_override: athlete.rank_override } : a,
        ),
      )
      setError(rpcError.message)
    }
    setPending((p) => ({ ...p, [athlete.id]: false }))
  }

  const [openSettings, setOpenSettings] = useState(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return athletes
    return athletes.filter((a) =>
      `${a.first_name} ${a.last_name} ${a.phone ?? ''}`.toLowerCase().includes(q),
    )
  }, [athletes, query])

  const markedToday = Object.values(today).filter((n) => n > 0).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="border-l-4 border-accent pl-4">
          <p className="label">Панель тренера</p>
          <h1 className="text-3xl">Посещаемость</h1>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <p className="font-display text-3xl">{athletes.length}</p>
            <p className="text-[11px] uppercase tracking-wider text-neutral-400">Учеников</p>
          </div>
          <div>
            <p className="font-display text-3xl text-accent">{markedToday}</p>
            <p className="text-[11px] uppercase tracking-wider text-neutral-400">Сегодня</p>
          </div>
        </div>
      </div>

      <CheckinQR />

      <AdminDebtors athletes={athletes} reloadKey={reloadKey} onPaid={() => load()} />

      <AdminSessions />

      <AdminMembers profiles={athletes} />

      <input
        type="search"
        className="input"
        placeholder="Поиск по имени или телефону…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {notice && <p className="rounded-md border border-accent bg-accent/10 p-3 font-semibold">{notice}</p>}
      {error && <p className="rounded-md border border-accent p-3 text-sm text-accent">{error}</p>}

      {loading ? (
        <div className="py-16 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-line border-t-accent" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="card text-center text-neutral-400">
          {athletes.length ? 'Никого не нашли' : 'Пока никто не зарегистрировался'}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((a) => {
            const { current, manual } = getRank(a.trainings_count, a.rank_override)
            const ranked = hasRanks(a.discipline)
            const settingsOpen = openSettings === a.id
            const todayCount = today[a.id] ?? 0
            const busy = pending[a.id]
            return (
              <li
                key={a.id}
                className={`card flex flex-col gap-4 !p-4 sm:flex-row sm:flex-wrap sm:items-center ${todayCount ? 'border-accent/60' : ''}`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  {/* Крупное селфи — чтобы узнать ученика в зале */}
                  <div className="relative h-16 w-16 shrink-0">
                    <div className="h-full w-full overflow-hidden rounded-full bg-ink ring-2 ring-line">
                      {a.photo ? (
                        <img src={a.photo} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full items-center justify-center font-display text-lg">
                          {a.first_name[0]}{a.last_name[0]}
                        </span>
                      )}
                    </div>
                    {todayCount > 0 && (
                      <span className="absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold">
                        ✓
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold">{a.first_name} {a.last_name}</p>
                    <p className="text-sm">
                      {ranked ? (
                        <span className="text-accent">
                          {current.title}
                          {manual && <span className="text-neutral-500"> · вручную</span>}
                        </span>
                      ) : (
                        <span className="text-neutral-400">{DISCIPLINES[a.discipline]}</span>
                      )}
                    </p>
                    <div className="mt-1">
                      <PaymentBadge billing={billing[a.id]} />
                    </div>
                    {a.phone && (
                      <a href={`tel:+${a.phone}`} className="text-xs text-neutral-500 hover:text-white">
                        {formatPhone(a.phone)}
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-16 text-center">
                    <p className="font-display text-3xl tabular-nums">{a.trainings_count}</p>
                    <p className="text-[10px] uppercase tracking-wider text-neutral-500">трен.</p>
                  </div>
                  <div className="flex flex-1 flex-col items-stretch gap-1 sm:flex-none">
                    <button
                      onClick={() => change(a, +1)}
                      className="btn-primary min-h-14 px-6 text-base select-none active:scale-95"
                    >
                      +1 Тренировка
                    </button>
                    {todayCount > 0 && (
                      <button
                        onClick={() => change(a, -1)}
                        className="text-xs text-neutral-500 hover:text-white"
                      >
                        Отменить ({todayCount} сегодня)
                      </button>
                    )}
                    <button
                      onClick={() => setOpenSettings(settingsOpen ? null : a.id)}
                      className="text-xs text-neutral-500 hover:text-white"
                      aria-expanded={settingsOpen}
                    >
                      {settingsOpen ? 'Скрыть настройки' : 'Ранг и направление'}
                    </button>
                  </div>
                </div>

                {/* Настройки ученика: направление + ручной ранг */}
                {settingsOpen && (
                  <div className="grid basis-full gap-3 border-t border-line pt-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="label">Направление</span>
                      <select
                        className="input"
                        value={a.discipline}
                        disabled={busy}
                        onChange={(e) => saveSettings(a, { discipline: e.target.value })}
                      >
                        {Object.entries(DISCIPLINES).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="label">Ранг грепплинга</span>
                      <select
                        className="input disabled:opacity-50"
                        value={a.rank_override ?? ''}
                        disabled={busy || !ranked}
                        onChange={(e) =>
                          saveSettings(a, { rank_override: e.target.value ? Number(e.target.value) : null })
                        }
                      >
                        <option value="">Авто — {autoRank(a.trainings_count).title}</option>
                        {RANKS.map((r) => (
                          <option key={r.id} value={r.id}>{r.title} (вручную)</option>
                        ))}
                      </select>
                    </label>
                    <div className="sm:col-span-2">
                      <CashPayment
                        athlete={a}
                        onDone={() => {
                          load()
                          setReloadKey((k) => k + 1)
                        }}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <DeleteAthlete
                        athlete={a}
                        onDeleted={() => {
                          setOpenSettings(null)
                          setNotice(`Аккаунт ${a.first_name} ${a.last_name} удалён`)
                          load()
                          setReloadKey((k) => k + 1)
                        }}
                      />
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
