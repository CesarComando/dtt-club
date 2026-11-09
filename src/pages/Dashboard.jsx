import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getRank, hasRanks, RANKS, DISCIPLINES, TRAININGS_PER_YEAR } from '../lib/ranks.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { isSupabaseConfigured } from '../lib/supabaseClient.js'
import BillingSection, { CustomAmount, liveSubscription, useBilling } from '../components/Billing.jsx'
import { formatDay, formatPrice } from '../lib/payments.js'
import { deleteMyAccount, loadMyFamily } from '../lib/club-ops.js'
import Booking from '../components/Booking.jsx'
import BodyStats from '../components/BodyStats.jsx'
import CrossTraining from '../components/CrossTraining.jsx'
import MyChildren from '../components/MyChildren.jsx'
import Notifications from '../components/Notifications.jsx'
import FriendInvites, { HideProfile } from '../components/FriendInvites.jsx'
import { ApprovedMark } from '../components/Approved.jsx'
import { t, lang, locale } from '../lib/i18n.jsx'
// Сканер с камерой грузится только по нажатию кнопки.
const QrScanner = lazy(() => import('../components/QrScanner.jsx'))

// Кнопка «Отметиться по QR»: камера прямо в приложении (обычная камера телефона тоже работает).
function ScanButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-primary flex w-full items-center justify-center gap-2">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" />
        </svg>
        {t('Сканировать QR — отметиться')}
      </button>
      {open && (
        <Suspense fallback={null}>
          <QrScanner onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  )
}

function experience(since) {
  const start = new Date(since)
  const now = new Date()
  const months = Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth())
  const y = Math.floor(months / 12)
  const m = months % 12
  return [y && t('{n} г.', { n: y }), t('{n} мес.', { n: m })].filter(Boolean).join(' ')
}

const formatDate = (iso) => new Date(iso).toLocaleDateString(locale(),{ day: 'numeric', month: 'short', year: 'numeric' })

// '37120000001' → '+371 2000 0001'
const formatPhone = (p) => (p?.startsWith('371') && p.length === 11 ? `+371 ${p.slice(3, 7)} ${p.slice(7)}` : p ? `+${p}` : '')

const HeartIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M12 21s-7.5-4.6-10-9.3C.4 8.5 2.3 4.5 6.1 4.5c2.2 0 3.6 1.2 4.4 2.4h3c.8-1.2 2.2-2.4 4.4-2.4 3.8 0 5.7 4 4.1 7.2C19.5 16.4 12 21 12 21z" />
  </svg>
)

// Подписка «Поддержать клуб» 5€/мес через Stripe. Флаг profiles.is_sponsor
// ставит сервер (вебхук → таблица subscriptions → триггер), не фронтенд.
function SupportClub({ isSponsor, billing }) {
  const product = billing.catalog.find((p) => p.kind === 'support')
  const sub = liveSubscription(billing.subscriptions, 'support')

  if (isSponsor || sub) {
    return (
      <section className="card space-y-3 border-accent/60">
        <div className="flex items-center gap-3">
        <HeartIcon className="h-6 w-6 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t('Спасибо, что поддерживаете клуб!')}</p>
          {sub?.cancel_at_period_end && sub.current_period_end && (
            <p className="text-sm text-neutral-400">{t('Поддержка действует до {date}.', { date: formatDay(sub.current_period_end) })}</p>
          )}
        </div>
        {sub && (
          <button type="button" onClick={billing.portal} className="text-xs text-neutral-500 hover:text-white">
            {t('Управлять')}
          </button>
        )}
        </div>
        <CustomAmount variant="support" onPay={billing.custom} busy={billing.busy} />
      </section>
    )
  }

  if (!product) return null

  return (
    <section className="space-y-2">
      <button
        type="button"
        disabled={Boolean(billing.busy)}
        onClick={() => billing.checkout(product.id)}
        className="group flex w-full items-center justify-center gap-3 rounded-lg bg-accent px-5 py-4 font-display text-lg uppercase tracking-wider text-white shadow-[0_0_24px_-6px] shadow-accent/60 transition hover:bg-accent-dark active:scale-[0.99] disabled:opacity-60"
      >
        <HeartIcon className="h-6 w-6 transition-transform group-hover:scale-110" />
        {billing.busy === product.id
          ? t('Переход к оплате…')
          : t('Поддержать клуб · {price}/мес', { price: formatPrice(product.amount_cents, product.currency) })}
      </button>
      {/* Разово — любую сумму от 1 до 500 € */}
      <CustomAmount variant="support" onPay={billing.custom} busy={billing.busy} />
    </section>
  )
}

// Оплата (абонемент, разовые, поддержка) — отдельный компонент, чтобы хук
// useBilling вызывался только для вошедшего пользователя.
function ClubPayments({ profile, family, onPaid }) {
  const billing = useBilling(profile.id, onPaid)
  return (
    <>
      <BillingSection billing={billing} discipline={profile.discipline} family={family} />
      <SupportClub isSponsor={profile.is_sponsor} billing={billing} />
    </>
  )
}

// Удаление аккаунта из приложения (требование Google Play / App Store).
function DeleteAccount({ isAdmin }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (isAdmin) return null

  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await deleteMyAccount()
      window.location.assign(window.location.href.split('#')[0] + '#/')
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <section className="border-t border-line pt-6 text-sm">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-neutral-500 hover:text-accent">
          {t('Удалить аккаунт')}
        </button>
      ) : (
        <div className="card space-y-3 border-accent/60">
          <h2 className="text-lg text-accent">{t('Удалить аккаунт навсегда?')}</h2>
          <p className="text-neutral-400">
            {t('Удалятся профиль, телефон, селфи, посещения, ранг и записи на тренировки. Подписки по карте будут отменены сразу. История платежей останется только в Stripe для бухгалтерии клуба. Отменить удаление нельзя.')}
          </p>
          <label className="block">
            <span className="label">{t('Для подтверждения введите УДАЛИТЬ')}</span>
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
          </label>
          {error && <p className="text-accent" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={remove}
              // Слово подтверждения — на языке интерфейса; на сервер всегда уходит 'УДАЛИТЬ' (club-ops.js).
              disabled={busy || text.trim().toUpperCase() !== (lang === 'lv' ? 'DZĒST' : 'УДАЛИТЬ')}
              className="btn-primary disabled:opacity-40"
            >
              {busy ? t('Удаляем…') : t('Удалить навсегда')}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className="btn-outline">
              {t('Отмена')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function Centered({ children }) {
  return <div className="mx-auto max-w-sm py-16 text-center">{children}</div>
}

export default function Dashboard() {
  const { user, profile, loading, error, refreshProfile, signOut } = useAuth()
  const [bookingKey, setBookingKey] = useState(0) // перечитать запись после «Записаться» по приглашению
  // Режим родителя (слой 35): сам не тренируется — видит только детское MMA и статус детей.
  const [family, setFamily] = useState(null)
  useEffect(() => {
    if (!user) return
    let alive = true
    loadMyFamily().then((f) => alive && setFamily(f))
    return () => {
      alive = false
    }
  }, [user])
  const parentOnly = Boolean(family?.parent_only)
  const navigate = useNavigate()

  if (!isSupabaseConfigured) {
    return <Centered><p className="text-neutral-400">{t('Supabase не настроен — заполните .env')}</p></Centered>
  }

  if (loading) {
    return (
      <Centered>
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-line border-t-accent" />
        <p className="mt-4 text-sm text-neutral-400">{t('Загружаем профиль…')}</p>
      </Centered>
    )
  }

  if (!user) {
    return (
      <Centered>
        <h1 className="text-3xl">{t('Личный кабинет')}</h1>
        <p className="mt-3 text-neutral-400">{t('Войдите, чтобы увидеть свой ранг, стаж и награды.')}</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link to="/login" className="btn-primary">{t('Войти')}</Link>
          <Link to="/register" className="btn-outline">{t('Регистрация')}</Link>
        </div>
      </Centered>
    )
  }

  if (error || !profile) {
    return (
      <Centered>
        <p className="text-accent">{error || t('Профиль не найден.')}</p>
        <button onClick={() => refreshProfile()} className="btn-outline mt-4">{t('Повторить')}</button>
      </Centered>
    )
  }

  const showRanks = hasRanks(profile.discipline)
  const { current, next, percent, remaining, manual } = getRank(profile.trainings_count, profile.rank_override)
  // Стаж — от реальной даты начала занятий, если тренер её указал.
  const since = profile.training_since ?? profile.created_at
  const initials = `${profile.first_name?.[0] ?? ''}${profile.last_name?.[0] ?? ''}`

  return (
    <div className="space-y-6">
      {/* Отмена / перенос тренировки, другой зал (слой 34) */}
      <Notifications />
      {/* Приглашения от друзей (слой 29) */}
      <FriendInvites onBooked={() => setBookingKey((k) => k + 1)} />

      {/* Профиль */}
      <section className="card flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink font-display text-xl ring-2 ring-accent">
          {profile.avatarSignedUrl ? (
            <img src={profile.avatarSignedUrl} alt={t('Селфи')} className="h-full w-full object-cover" />
          ) : (
            initials
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl leading-tight">
            <span className="truncate">{profile.first_name} {profile.last_name}</span>
            <ApprovedMark approved={profile.approved_at} />
          </h1>
          {!profile.approved_at && profile.role === 'athlete' && (
            <p className="text-xs text-neutral-500">{t('Ожидает подтверждения тренером')}</p>
          )}
          <p className="text-sm text-neutral-400">
            {t('В клубе с {date}', { date: formatDate(since) })}
            {profile.phone && <> · {formatPhone(profile.phone)}</>}
          </p>
        </div>
      </section>

      {profile.role === 'athlete' && <ScanButton />}

      {/* Статистика */}
      <section className="grid grid-cols-3 gap-3">
        {[
          { label: t('Тренировок'), value: profile.trainings_count },
          { label: t('Стаж'), value: experience(since) },
          { label: t('Медалей'), value: 0 },
        ].map((s) => (
          <div key={s.label} className="card !p-4 text-center">
            <p className="font-display text-2xl md:text-3xl">{s.value}</p>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-neutral-400">{s.label}</p>
          </div>
        ))}
      </section>

      {/* Ранг и прогресс — только грепплинг (APP_PASSPORT §3) */}
      {showRanks ? (
        <section className="card">
          <p className="label">{t('Ранг грепплинга')} · {current.id}/{RANKS.length}</p>
          <h2 className="text-3xl text-accent">{current.title}</h2>

          {manual ? (
            <p className="mt-3 text-sm text-neutral-400">{t('Ранг назначен тренером.')}</p>
          ) : (
            <>
              <div
                className="mt-4 h-3 overflow-hidden rounded-full bg-ink"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label={t('Прогресс до следующего ранга')}
              >
                <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${percent}%` }} />
              </div>
              <div className="mt-2 flex justify-between gap-4 text-sm text-neutral-400">
                <span>{percent}%</span>
                <span className="text-right">
                  {next ? (
                    <>{t('Ещё')} <b className="text-white">{remaining}</b> {t('трен. до «{rank}»', { rank: next.title })}</>
                  ) : (
                    t('Максимальный ранг клуба')
                  )}
                </span>
              </div>
            </>
          )}

          {/* Лестница рангов */}
          <ol className="mt-5 grid grid-cols-5 gap-1.5">
            {RANKS.map((r) => (
              <li
                key={r.id}
                className={`rounded border px-1 py-2 text-center ${
                  r.id === current.id ? 'border-accent' : 'border-line'
                } ${r.id <= current.id ? 'text-white' : 'text-neutral-600'}`}
              >
                <p className="font-display text-[10px] uppercase leading-tight md:text-xs">{r.title}</p>
                <p className="mt-1 text-[10px] text-neutral-500">{r.years ? t('{n}+ г.', { n: r.years }) : t('старт')}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-neutral-500">
            {t('Ранг растёт с каждой тренировкой (1 год ≈ {n} тренировок). Тренер может изменить его вручную.', { n: TRAININGS_PER_YEAR })}
          </p>
        </section>
      ) : (
        <section className="card">
          <p className="label">{t('Направление')}</p>
          <h2 className="text-2xl">{DISCIPLINES[profile.discipline]}</h2>
          <p className="mt-2 text-sm text-neutral-400">{t('Система рангов пока действует только в грепплинге.')}</p>
        </section>
      )}

      {/* Рост, вес, дата рождения + ИМТ (слой 13, закрытая таблица profile_body) */}
      <BodyStats userId={user.id} />

      {/* Запись на тренировки (слой 8): лимит мест проверяет сервер.
          key: после переключателя направления список перечитывается. */}
      {!parentOnly && <CrossTraining profile={profile} onChange={() => refreshProfile()} />}
      <Booking key={`${profile.cross_training}-${bookingKey}-${parentOnly}`} kidsOnly={parentOnly} />
      <HideProfile profile={profile} onChange={() => refreshProfile()} />
      <MyChildren profile={profile} />

      {/* Оплата (Stripe): абонемент, разовые тренировки, «Поддержать клуб» */}
      <ClubPayments profile={profile} family={family} onPaid={() => refreshProfile()} />

      {/* Мерч GERA — неактивная карточка-анонс */}
      <Link
        to="/shop"
        className="relative block overflow-hidden rounded-lg border border-line bg-panel p-5 transition hover:border-accent"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 3l5 3-2 4-2-1v12H7V9L5 10 3 6l5-3a4 4 0 0 0 8 0z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display uppercase tracking-wide">{t('Экипировка и мерч')}</p>
            <p className="text-sm text-neutral-400">{t('Форма GERA с дизайнами клуба, брелоки и аксессуары')}</p>
          </div>
          <span className="text-accent">→</span>
        </div>
      </Link>

      {/* Награды — таблица наград появится в следующем слое */}
      <section className="space-y-3">
        <h2 className="text-lg">{t('Мои награды и соревнования')}</h2>
        <p className="card text-neutral-400">{t('Пока нет наград — всё впереди!')}</p>
      </section>

      {/* На телефоне «Выйти» — здесь (в нижнем меню не помещается); на компьютере — в шапке */}
      <button
        type="button"
        onClick={async () => {
          await signOut()
          navigate('/')
        }}
        className="btn-outline w-full md:hidden"
      >
        {t('Выйти из аккаунта')}
      </button>

      <DeleteAccount isAdmin={profile.role === 'admin'} />
    </div>
  )
}
