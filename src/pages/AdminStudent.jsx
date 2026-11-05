import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, AVATARS_BUCKET } from '../lib/supabaseClient.js'
import { getRank, hasRanks, DISCIPLINES, RANKS } from '../lib/ranks.js'
import { formatDay, formatPrice, LIVE_STATUSES } from '../lib/payments.js'
import { ageFrom, bmi, bmiCategory } from '../lib/diary.js'
import { CRITERIA } from '../lib/ratings.js'
import { ApprovedMark, ApproveButton } from '../components/Approved.jsx'
import { MembershipLine, loadMemberships } from '../components/AdminMemberships.jsx'
import { sessionDay, sessionTime } from '../lib/booking.js'

// CRM → карточка ученика. Открывается по имени:
//   /admin/member/:id  — ученик клуба (club_members), даже без аккаунта в приложении;
//   /admin/athlete/:id — аккаунт в приложении (profiles).
// Если запись клуба и аккаунт связаны — показываем всё вместе.
// Данные читаются под правами тренера (RLS: is_admin).

const STATUS = { regular: 'Постоянный', occasional: 'Иногда', one_time: 'Был раз', left: 'Ушёл' }
const KIND = {
  training: 'тренировка', membership: 'абонемент', pack: 'пакет', individual: 'индивид.',
  uniform: 'форма', donation: 'пожертвование', other: 'другое',
}
const SUB_STATUS = { active: 'активна', trialing: 'пробный', past_due: 'долг по карте', canceled: 'отменена', unpaid: 'не оплачена' }
const phoneText = (p) => (p?.startsWith('371') && p.length === 11 ? `+371 ${p.slice(3, 7)} ${p.slice(7)}` : p ? `+${p}` : '')
const shortDay = (iso) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' })

async function loadStudent(kind, id) {
  let member = null
  let profileId = kind === 'athlete' ? id : null

  const memberQuery = supabase.from('club_members').select('*, member_payments(id, paid_on, amount_cents, kind, method, description)')
  if (kind === 'member') {
    const { data, error } = await memberQuery.eq('id', id).maybeSingle()
    if (error) throw error
    member = data
    profileId = data?.profile_id ?? null
  } else {
    const { data } = await memberQuery.eq('profile_id', id).maybeSingle()
    member = data
  }
  member?.member_payments?.sort((a, b) => (a.paid_on < b.paid_on ? 1 : -1))

  const overview = await loadMemberships().catch(() => [])
  const membership =
    overview.find((r) => (member && r.member_id === member.id) || (profileId && !r.member_id && r.profile_id === profileId)) ?? null

  if (!profileId) return { member, membership, profile: null }

  const since = new Date(Date.now() - 365 * 864e5).toISOString()
  const [p, contact, body, att, books, subs, pays, diary, learned, rating] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', profileId).maybeSingle(),
    supabase.from('profile_contacts').select('phone').eq('id', profileId).maybeSingle(),
    supabase.from('profile_body').select('height, weight, birth_date').eq('id', profileId).maybeSingle(),
    supabase.from('attendance').select('id, created_at, method').eq('athlete_id', profileId).gte('created_at', since)
      .order('created_at', { ascending: false }),
    supabase.from('bookings').select('session:training_sessions(id, starts_at, ends_at, cancelled, slot:training_slots(title))')
      .eq('athlete_id', profileId),
    supabase.from('subscriptions').select('status, current_period_end, cancel_at_period_end, product:payment_products(title)')
      .eq('user_id', profileId),
    supabase.from('payments').select('id, amount_cents, currency, status, method, created_at, product:payment_products(title)')
      .eq('user_id', profileId).order('created_at', { ascending: false }).limit(20),
    supabase.from('training_diary').select('id, date, notes, applied_techniques').eq('user_id', profileId)
      .order('date', { ascending: false }).limit(10),
    supabase.from('user_learned_techniques').select('status, technique:techniques_dictionary(name)').eq('user_id', profileId),
    supabase.rpc('peer_rating_summary', { p_target: profileId }),
  ])
  if (p.error) throw p.error
  const profile = p.data
  let photo = null
  if (profile?.avatar_url) {
    const { data } = await supabase.storage.from(AVATARS_BUCKET).createSignedUrl(profile.avatar_url, 3600)
    photo = data?.signedUrl ?? null
  }
  const now = Date.now()
  return {
    member,
    membership,
    profile: profile && {
      ...profile,
      photo,
      phone: contact.data?.phone ?? null,
      body: body.data,
      attendance: att.data ?? [],
      upcoming: (books.data ?? [])
        .map((b) => b.session)
        .filter((s) => s && new Date(s.ends_at).getTime() > now)
        .sort((a, b) => (a.starts_at > b.starts_at ? 1 : -1)),
      subscriptions: subs.data ?? [],
      payments: pays.data ?? [],
      diary: diary.data ?? [],
      learned: learned.data ?? [],
      rating: rating.data?.[0] ?? null,
    },
  }
}

export default function AdminStudent({ kind }) {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setError('')
    loadStudent(kind, kind === 'member' ? Number(id) : id)
      .then(setData)
      .catch((e) => setError(e.message))
  }, [kind, id])

  useEffect(() => {
    load()
  }, [load])

  const back = (
    <Link to={kind === 'member' ? '/admin?tab=students' : '/admin'} className="text-sm text-neutral-400 hover:text-white">
      ← {kind === 'member' ? 'Ученики' : 'Зал'}
    </Link>
  )

  if (error) return <div className="space-y-4">{back}<p className="rounded-md border border-accent p-3 text-accent">{error}</p></div>
  if (!data) {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-line border-t-accent" />
      </div>
    )
  }

  const { member, profile, membership } = data
  if (!member && !profile) return <div className="space-y-4">{back}<p className="card text-neutral-400">Ученик не найден.</p></div>

  const first = profile?.first_name || member?.first_name
  const last = profile?.last_name || member?.last_name
  const discipline = profile?.discipline ?? member?.discipline
  const phone = profile?.phone ?? member?.phone

  return (
    <div className="space-y-5">
      {back}

      {/* Шапка */}
      <section className="card flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink font-display text-2xl ring-2 ring-accent">
          {profile?.photo ? <img src={profile.photo} alt="" className="h-full w-full object-cover" /> : `${first?.[0] ?? ''}${last?.[0] ?? ''}`}
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <h1 className="flex items-center gap-2 text-2xl leading-tight">
            <span>{first} {last}</span>
            <ApprovedMark approved={profile?.approved_at} />
          </h1>
          <p className="text-sm text-neutral-400">
            {[discipline && DISCIPLINES[discipline], member && STATUS[member.status], member?.parent_name && `родитель: ${member.parent_name}`]
              .filter(Boolean).join(' · ')}
          </p>
          {phone && <a href={`tel:+${phone}`} className="text-sm text-neutral-300 hover:text-accent">{phoneText(phone)}</a>}
          <p className="text-xs">
            {profile ? (
              <span className="flex flex-wrap items-center gap-3">
                <span className="text-emerald-400">● В приложении с {formatDay(profile.created_at)}</span>
                <ApproveButton
                  athlete={profile}
                  onChange={(at) => setData((d) => ({ ...d, profile: { ...d.profile, approved_at: at } }))}
                />
              </span>
            ) : (
              <span className="text-neutral-500">Нет аккаунта в приложении</span>
            )}
          </p>
        </div>
      </section>

      <section className="card space-y-1">
        <p className="label">Абонемент</p>
        {membership?.valid_until ? (
          <MembershipLine row={membership} className="text-base" />
        ) : (
          <p className="text-neutral-400">Абонемент ни разу не оплачивался.</p>
        )}
        {member?.single_price_cents && (
          <p className="text-sm text-emerald-400">Особая цена разовой: {formatPrice(member.single_price_cents)}</p>
        )}
      </section>

      {member?.notes && <p className="card text-sm text-neutral-300">{member.notes}</p>}
      {member?.aliases?.length > 0 && <p className="text-xs text-neutral-500">В группе: {member.aliases.join(', ')}</p>}

      {profile ? <AppData profile={profile} /> : member?.rank_override && (
        <section className="card"><p className="label">Ранг</p><p className="text-xl text-accent">{RANKS[member.rank_override - 1]?.title}</p></section>
      )}

      {member && <MemberPayments member={member} />}
    </div>
  )
}

function AppData({ profile }) {
  const ranked = hasRanks(profile.discipline)
  const { current, manual } = getRank(profile.trainings_count, profile.rank_override)
  const value = bmi(profile.body?.height, profile.body?.weight)
  const age = ageFrom(profile.body?.birth_date)
  const cat = bmiCategory(value, age)
  const live = profile.subscriptions.filter((s) => LIVE_STATUSES.includes(s.status))
  const month = profile.attendance.filter((a) => new Date(a.created_at).getTime() > Date.now() - 30 * 864e5).length
  const mastered = profile.learned.filter((l) => l.status === 'mastered')
  const learning = profile.learned.filter((l) => l.status === 'learning')
  const r = profile.rating

  return (
    <>
      <section className="grid grid-cols-3 gap-3">
        {[
          { label: 'Тренировок', value: profile.trainings_count },
          { label: 'За 30 дней', value: month },
          { label: ranked ? (manual ? 'Ранг · вручную' : 'Ранг') : 'Направление', value: ranked ? current.title : DISCIPLINES[profile.discipline] },
        ].map((s) => (
          <div key={s.label} className="card !p-3 text-center">
            <p className="font-display text-xl leading-tight md:text-2xl">{s.value}</p>
            <p className="mt-1 text-[10px] uppercase tracking-wider text-neutral-400">{s.label}</p>
          </div>
        ))}
      </section>

      <section className="card space-y-2">
        <p className="label">Оплата в приложении</p>
        {live.length ? (
          live.map((s, i) => (
            <p key={i} className="text-sm">
              <span className="font-semibold">{s.product?.title}</span> — {SUB_STATUS[s.status] ?? s.status}
              {s.current_period_end && <span className="text-neutral-400"> · до {formatDay(s.current_period_end)}</span>}
              {s.cancel_at_period_end && <span className="text-accent"> · не продлится</span>}
            </p>
          ))
        ) : (
          <p className="text-sm text-neutral-400">Активной подписки нет.</p>
        )}
        {profile.payments.length > 0 && (
          <ul className="divide-y divide-line text-sm">
            {profile.payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">
                  {shortDay(p.created_at)} · {p.product?.title ?? 'Оплата'}
                  <span className="text-neutral-500"> · {p.method === 'cash' ? 'наличные' : 'карта'}</span>
                </span>
                <span className={p.status === 'paid' ? '' : 'text-accent'}>
                  {formatPrice(p.amount_cents, p.currency)}{p.status !== 'paid' && ` · ${p.status === 'refunded' ? 'возврат' : p.status}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-2">
        <p className="label">Записан на тренировки</p>
        {profile.upcoming.length ? (
          <ul className="space-y-1 text-sm">
            {profile.upcoming.map((s) => (
              <li key={s.id} className={s.cancelled ? 'text-neutral-500 line-through' : ''}>
                {sessionDay(s.starts_at)} · {sessionTime(s)} · {s.slot?.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-400">Никуда не записан.</p>
        )}
      </section>

      <section className="card space-y-2">
        <p className="label">Посещения за год · {profile.attendance.length}</p>
        {profile.attendance.length ? (
          <div className="flex flex-wrap gap-1.5">
            {profile.attendance.slice(0, 40).map((a) => (
              <span key={a.id} className="rounded border border-line px-2 py-0.5 text-xs text-neutral-300">
                {shortDay(a.created_at)}{a.method === 'qr' && ' · QR'}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-400">Отметок пока нет.</p>
        )}
      </section>

      <section className="card space-y-1">
        <p className="label">Параметры</p>
        {profile.body ? (
          <p className="text-sm">
            {[profile.body.height && `${profile.body.height} см`, profile.body.weight && `${profile.body.weight} кг`, age != null && `${age} лет`]
              .filter(Boolean).join(' · ') || '—'}
            {value != null && <span className="text-neutral-400"> · ИМТ {value}{cat && ` (${cat.label.toLowerCase()})`}</span>}
          </p>
        ) : (
          <p className="text-sm text-neutral-400">Не заполнены.</p>
        )}
      </section>

      <section className="card space-y-2">
        <p className="label">Приёмы · освоил {mastered.length} · изучает {learning.length}</p>
        {profile.learned.length ? (
          <div className="flex flex-wrap gap-1.5">
            {[...mastered, ...learning].map((l, i) => (
              <span key={i} className={`rounded-full border px-2.5 py-0.5 text-xs ${l.status === 'mastered' ? 'border-accent bg-accent/15' : 'border-line text-neutral-400'}`}>
                {l.status === 'mastered' ? '✓ ' : '◐ '}{l.technique?.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-400">Пока ничего не отметил.</p>
        )}
      </section>

      <section className="card space-y-2">
        <p className="label">Оценки партнёров · {r?.ratings ?? 0}</p>
        {r?.ratings ? (
          <ul className="space-y-1.5">
            {CRITERIA.map((c) => (
              <li key={c.key} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-neutral-300">{c.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink">
                  <div className="h-full bg-accent" style={{ width: `${(Number(r[c.key] ?? 0) / 5) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums">{r[c.key] == null ? '—' : Number(r[c.key]).toFixed(1)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-400">Его пока никто не оценил.</p>
        )}
      </section>

      <section className="card space-y-2">
        <p className="label">Дневник · последние записи</p>
        {profile.diary.length ? (
          <ul className="space-y-3">
            {profile.diary.map((d) => (
              <li key={d.id} className="text-sm">
                <p className="font-semibold">{formatDay(d.date)}</p>
                {d.notes && <p className="whitespace-pre-line text-neutral-300">{d.notes}</p>}
                {d.applied_techniques.length > 0 && <p className="text-xs text-neutral-500">{d.applied_techniques.join(' · ')}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-400">Записей нет.</p>
        )}
      </section>
    </>
  )
}

function MemberPayments({ member }) {
  const pays = member.member_payments ?? []
  const total = pays.reduce((s, p) => s + p.amount_cents, 0)
  return (
    <section className="card space-y-2">
      <p className="label">Оплаты переводом и наличными · {pays.length} · {formatPrice(total)}</p>
      {pays.length ? (
        <ul className="max-h-80 divide-y divide-line overflow-y-auto text-sm">
          {pays.map((p) => (
            <li key={p.id} className="flex justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate">
                {shortDay(p.paid_on)} · {KIND[p.kind] ?? p.kind}
                <span className="text-neutral-500"> · {p.method === 'cash' ? 'наличные' : 'перевод'}</span>
              </span>
              <span>{formatPrice(p.amount_cents)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-400">Оплат нет.</p>
      )}
      <p className="text-xs text-neutral-500">Записать оплату — во вкладке «Ученики», нажмите на сумму справа от имени.</p>
    </section>
  )
}
