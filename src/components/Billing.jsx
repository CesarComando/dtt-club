import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  LIVE_STATUSES,
  formatDay,
  formatPrice,
  loadCatalog,
  loadMyBilling,
  openCustomerPortal,
  startCheckout,
  startCustomCheckout,
} from '../lib/payments.js'
import { t, tData } from '../lib/i18n.jsx'

/**
 * Каталог, подписки и платежи текущего ученика + действия оплаты.
 * После возврата со Stripe (?payment=success) несколько раз перечитывает
 * статус: вебхук обычно приходит за пару секунд.
 */
export function useBilling(userId, onPaid) {
  const [params, setParams] = useSearchParams()
  const returned = params.get('payment')
  const [catalog, setCatalog] = useState([])
  const [billing, setBilling] = useState({ subscriptions: [], payments: [], offline: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null) // id товара или 'portal', пока идёт переход
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(
    returned === 'success' ? t('Спасибо! Оплата прошла, обновляем статус…') : returned === 'cancel' ? t('Оплата отменена.') : '',
  )

  const refresh = useCallback(async () => {
    try {
      const [c, b] = await Promise.all([loadCatalog(), loadMyBilling(userId)])
      setCatalog(c)
      setBilling(b)
      return b
    } catch (e) {
      setError(t('Не удалось загрузить оплату: ') + e.message)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Возврат со страницы оплаты: ждём вебхук (до ~20 с), потом убираем ?payment из адреса.
  useEffect(() => {
    if (!returned) return
    setParams({}, { replace: true })
    if (returned !== 'success') return
    let tries = 0
    let stopped = false
    const before = Date.now() - 10 * 60 * 1000
    const tick = async () => {
      if (stopped) return
      const b = await refresh()
      const fresh =
        b?.payments.some((p) => new Date(p.created_at).getTime() > before) ||
        b?.subscriptions.some((s) => new Date(s.updated_at).getTime() > before)
      if (fresh || ++tries >= 8) {
        setNotice(fresh ? t('Оплата получена — спасибо!') : t('Оплата принята Stripe. Статус обновится в течение минуты.'))
        onPaid?.()
        return
      }
      setTimeout(tick, 2500)
    }
    tick()
    return () => {
      stopped = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // «Назад» со страницы Stripe: браузер достаёт страницу из памяти (bfcache) вместе
  // с кнопкой «Переход к оплате…». Снимаем блокировку и перечитываем статус.
  useEffect(() => {
    const onShow = (e) => {
      if (!e.persisted) return
      setBusy(null)
      refresh()
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [refresh])

  const go = async (key, action) => {
    setError('')
    setBusy(key)
    try {
      await action()
    } catch (e) {
      setError(e.message)
      setBusy(null)
    }
  }

  return {
    catalog,
    ...billing,
    loading,
    busy,
    error,
    notice,
    checkout: (productId) => go(productId, () => startCheckout(productId)),
    custom: (cents, note) => go('custom', () => startCustomCheckout(cents, note)),
    portal: () => go('portal', openCustomerPortal),
  }
}

export const liveSubscription = (subscriptions, kind) =>
  subscriptions.find((s) => s.product?.kind === kind && LIVE_STATUSES.includes(s.status))

const DAY = 864e5
const daysLeft = (iso) => Math.ceil((new Date(iso).getTime() - Date.now()) / DAY)

// Абонемент, оплаченный тренеру наличными (самый поздний срок).
export const cashMembership = (payments) =>
  payments
    .filter((p) => p.method === 'cash' && p.status === 'paid' && p.period_end && new Date(p.period_end) > new Date())
    .sort((a, b) => b.period_end.localeCompare(a.period_end))[0] ?? null

/** Напоминание за 3 дня: спишется с карты или закончится абонемент за наличные. */
function Reminder({ card, cash, catalog }) {
  if (card && card.status !== 'past_due' && !card.cancel_at_period_end && card.current_period_end) {
    const d = daysLeft(card.current_period_end)
    if (d <= 3 && d >= 0) {
      const price = catalog.find((p) => p.id === card.product_id)
      return (
        <p className="rounded-md border border-accent/60 bg-accent/10 p-3 text-sm" role="status">
          ⏰ {d <= 0 ? t('Сегодня') : d === 1 ? t('Завтра') : t('Через {n} дн.', { n: d })} ({formatDay(card.current_period_end)}){' '}
          {t('с карты спишется {amount} за следующий месяц.', { amount: price ? formatPrice(price.amount_cents, price.currency) : t('оплата') })}{' '}
          {t('Отменить можно в «Управлении оплатой».')}
        </p>
      )
    }
  }
  if (!card && cash) {
    const d = daysLeft(cash.period_end)
    if (d <= 3) {
      return (
        <p className="rounded-md border border-accent/60 bg-accent/10 p-3 text-sm" role="status">
          ⏰ {t('Абонемент заканчивается {date}. Продлите у тренера или картой ниже.', { date: formatDay(cash.period_end) })}
        </p>
      )
    }
  }
  return null
}

function SubscriptionStatus({ sub }) {
  const until = sub.current_period_end ? formatDay(sub.current_period_end) : '—'
  if (sub.status === 'past_due') {
    return (
      <p className="text-accent">
        {t('Не удалось списать оплату. Обновите карту в «Управлении оплатой».')}
      </p>
    )
  }
  return (
    <>
      <p className="text-lg">
        {t('Абонемент оплачен до')} <b className="text-white">{until}</b>
      </p>
      <p className="text-sm text-neutral-400">
        {sub.status === 'bank'
          ? t('Оплачено переводом или наличными тренеру — месяц со дня оплаты.')
          : sub.status === 'cash'
          ? t('Оплачено наличными у тренера.')
          : sub.cancel_at_period_end
            ? t('Автопродление выключено.')
            : t('Продлится автоматически.')}
      </p>
    </>
  )
}

/** Блок «Оплата» в личном кабинете. */
// Режим родителя (слой 35): статус абонемента каждого ребёнка.
function ChildrenStatus({ children }) {
  return (
    <ul className="space-y-1">
      {children.map((c, i) => (
        <li key={i} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm">
          <span className="font-semibold">{c.name}</span>
          {c.active ? (
            <span className="text-emerald-400">{t('абонемент до {date}', { date: formatDay(c.valid_until) })}</span>
          ) : c.valid_until ? (
            <span className="text-accent">{t('закончился {date}', { date: formatDay(c.valid_until) })}</span>
          ) : (
            <span className="text-accent">{t('не оплачен')}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

export default function BillingSection({ billing, discipline, family }) {
  const parentOnly = Boolean(family?.parent_only)
  if (parentOnly) discipline = 'mma' // родитель платит только за детское MMA
  const { catalog, subscriptions, payments, offline = [], overview, loading, busy, error, notice, checkout, custom, portal } = billing
  if (loading) return null

  const cardMembership = liveSubscription(subscriptions, 'membership')
  // Абонемент переводом/наличными тренеру из списка клуба — месяц от дня оплаты (слой 17).
  const bank = overview?.source === 'bank' && overview.active ? { period_end: overview.valid_until } : null
  const cash = cashMembership(payments) ?? bank
  const membership =
    cardMembership ??
    (cash && {
      status: cash === bank ? 'bank' : 'cash',
      current_period_end: cash.period_end,
      cancel_at_period_end: true,
      product: { title: catalog.find((p) => p.id === cash.product_id)?.title ?? t('Абонемент') },
    })
  const kidsPaid = parentOnly && family.children.every((c) => c.active)
  const ended = !parentOnly && !membership && overview?.valid_until && !overview.active ? overview.valid_until : null
  // 'both' — показываем оба направления.
  const mine = (p) => !p.discipline || discipline === 'both' || p.discipline === discipline
  const memberships = catalog.filter((p) => p.kind === 'membership' && mine(p))
  const singles = catalog.filter((p) => p.kind === 'single' && mine(p))
  // Название для родителя: «Детское MMA», а не взрослое «MMA / K1».
  const title = (p) => (parentOnly ? t('Детское MMA') : tData(p.title).replace('Абонемент ', '').replace('Abonements ', ''))
  const hasHistory = subscriptions.length > 0 || payments.length > 0
  // Портал Stripe есть только у тех, кто хоть раз платил картой.
  const hasCard = subscriptions.length > 0 || payments.some((p) => p.method !== 'cash')
  const titles = Object.fromEntries(catalog.map((p) => [p.id, tData(p.title)]))

  return (
    <section className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label">{parentOnly ? t('Оплата за ребёнка') : t('Оплата')}</p>
          {parentOnly && !membership ? (
            <h2 className="text-2xl">{kidsPaid ? t('Абонемент оплачен') : t('Детское MMA')}</h2>
          ) : membership ? (
            <>
              <h2 className="text-2xl">{tData(membership.product?.title)}</h2>
              <div className="mt-1">
                <SubscriptionStatus sub={membership} />
              </div>
            </>
          ) : (
            <>
              <h2 className="text-2xl">{t('Абонемент не оплачен')}</h2>
              {ended && <p className="text-sm text-neutral-400">{t('Последний закончился {date}', { date: formatDay(ended) })}</p>}
            </>
          )}
        </div>
        {(membership || kidsPaid) && <span className="rounded border border-accent px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent">{t('Активен')}</span>}
      </div>

      {parentOnly && <ChildrenStatus children={family.children} />}

      <Reminder card={cardMembership} cash={cash} catalog={catalog} />

      {overview?.single_price_cents && (
        <p className="rounded-md border border-emerald-500/50 p-3 text-sm">
          {t('Ваша цена разовой тренировки —')} <b>{formatPrice(overview.single_price_cents)}</b> {t('(переводом или наличными тренеру).')}
        </p>
      )}

      {notice && <p className="rounded-md border border-accent/60 bg-accent/10 p-3 text-sm" role="status">{notice}</p>}
      {error && <p className="rounded-md border border-accent p-3 text-sm text-accent" role="alert">{error}</p>}

      {!membership && !kidsPaid && memberships.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {memberships.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={Boolean(busy)}
              onClick={() => checkout(p.id)}
              className="btn-primary flex min-h-14 flex-col items-center justify-center !py-2 disabled:opacity-60"
            >
              <span>{busy === p.id ? t('Переход к оплате…') : `${title(p)} · ${formatPrice(p.amount_cents, p.currency)}${t('/мес')}`}</span>
              <span className="text-[11px] normal-case tracking-normal opacity-80">{t('абонемент, автопродление')}</span>
            </button>
          ))}
        </div>
      )}

      {singles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {singles.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={Boolean(busy)}
              onClick={() => checkout(p.id)}
              className="btn-outline flex-1 whitespace-nowrap disabled:opacity-60"
            >
              {busy === p.id ? t('Переход…') : `${parentOnly ? t('Разовая тренировка ребёнка') : tData(p.title)} · ${formatPrice(p.amount_cents, p.currency)}`}
            </button>
          ))}
        </div>
      )}

      <CustomAmount onPay={custom} busy={busy} />

      {hasHistory && (
        <>
          {payments.length > 0 && (
            <ul className="divide-y divide-line border-t border-line text-sm">
              {payments.slice(0, 5).map((p) => (
                <li key={p.id} className="flex justify-between gap-3 py-2">
                  <span className="truncate text-neutral-300">
                    {p.note || titles[p.product_id] || t('Оплата')} · {formatDay(p.created_at)}
                  </span>
                  <span className={p.status === 'paid' ? '' : 'text-accent'}>
                    {p.status === 'failed' ? t('не прошла') : p.status === 'refunded' ? t('возврат') : formatPrice(p.amount_cents, p.currency)}
                    {p.method === 'cash' && p.status === 'paid' && <span className="text-neutral-500"> · {t('нал.')}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {hasCard && <button
            type="button"
            onClick={portal}
            disabled={Boolean(busy)}
            className="text-sm text-neutral-400 underline-offset-4 hover:text-white hover:underline disabled:opacity-60"
          >
            {busy === 'portal' ? t('Открываем…') : t('Управление оплатой: карта, счета, отмена подписки')}
          </button>}
        </>
      )}

      {offline.length > 0 && (
        <details className="border-t border-line pt-2 text-sm">
          <summary className="cursor-pointer text-neutral-400">
            {t('Оплаты переводом и наличными: {n}', { n: offline.length })} ·{formatPrice(offline.reduce((s, p) => s + p.amount_cents, 0))}
          </summary>
          <ul className="mt-2 max-h-48 divide-y divide-line overflow-y-auto">
            {offline.map((p) => (
              <li key={p.id} className="flex justify-between gap-3 py-1.5 text-neutral-300">
                <span>{formatDay(p.paid_on)}{p.method === 'cash' ? ` · ${t('нал.')}` : ` · ${t('перевод')}`}</span>
                <span>{formatPrice(p.amount_cents)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-xs text-neutral-500">{t('Оплата картой через Stripe. Цены указаны с НДС. Первая тренировка — бесплатно.')}</p>
    </section>
  )
}

// «Своя сумма» (слой 26): ученик сам вводит сумму (1–500 €) и, по желанию, за что платит.
function CustomAmount({ onPay, busy }) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const cents = Math.round(Number(String(amount).replace(',', '.')) * 100)
  const valid = Number.isFinite(cents) && cents >= 100 && cents <= 50000

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-outline w-full">
        {t('Оплатить свою сумму')}
      </button>
    )
  return (
    <form
      className="space-y-2 rounded-md border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onPay(cents, note.trim())
      }}
    >
      <p className="text-sm font-semibold">{t('Своя сумма')}</p>
      <div className="grid grid-cols-[8rem_1fr] gap-2">
        <input
          inputMode="decimal"
          required
          autoFocus
          placeholder={t('Сумма, €')}
          aria-label={t('Сумма в евро')}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="input"
        />
        <input
          maxLength={120}
          placeholder={t('За что (необязательно): 3 тренировки, долг…')}
          aria-label={t('За что')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="input"
        />
      </div>
      {amount && !valid && <p className="text-xs text-accent">{t('Сумма от 1 до 500 €')}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={!valid || Boolean(busy)} className="btn-primary flex-1 disabled:opacity-60">
          {busy === 'custom' ? t('Переход к оплате…') : valid ? t('Оплатить {amount}', { amount: formatPrice(cents) }) : t('Оплатить')}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={Boolean(busy)} className="btn-outline">
          {t('Отмена')}
        </button>
      </div>
      <p className="text-xs text-neutral-500">{t('Разовая оплата картой. Абонемент так не продлевается — для него кнопки выше.')}</p>
    </form>
  )
}
