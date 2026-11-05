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
} from '../lib/payments.js'

/**
 * Каталог, подписки и платежи текущего ученика + действия оплаты.
 * После возврата со Stripe (?payment=success) несколько раз перечитывает
 * статус: вебхук обычно приходит за пару секунд.
 */
export function useBilling(userId, onPaid) {
  const [params, setParams] = useSearchParams()
  const returned = params.get('payment')
  const [catalog, setCatalog] = useState([])
  const [billing, setBilling] = useState({ subscriptions: [], payments: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null) // id товара или 'portal', пока идёт переход
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(
    returned === 'success' ? 'Спасибо! Оплата прошла, обновляем статус…' : returned === 'cancel' ? 'Оплата отменена.' : '',
  )

  const refresh = useCallback(async () => {
    try {
      const [c, b] = await Promise.all([loadCatalog(), loadMyBilling(userId)])
      setCatalog(c)
      setBilling(b)
      return b
    } catch (e) {
      setError('Не удалось загрузить оплату: ' + e.message)
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
        setNotice(fresh ? 'Оплата получена — спасибо!' : 'Оплата принята Stripe. Статус обновится в течение минуты.')
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
    portal: () => go('portal', openCustomerPortal),
  }
}

export const liveSubscription = (subscriptions, kind) =>
  subscriptions.find((s) => s.product?.kind === kind && LIVE_STATUSES.includes(s.status))

function SubscriptionStatus({ sub }) {
  const until = sub.current_period_end ? formatDay(sub.current_period_end) : '—'
  if (sub.status === 'past_due') {
    return (
      <p className="text-accent">
        Не удалось списать оплату. Обновите карту в «Управлении оплатой».
      </p>
    )
  }
  return (
    <>
      <p className="text-lg">
        Абонемент оплачен до <b className="text-white">{until}</b>
      </p>
      <p className="text-sm text-neutral-400">
        {sub.cancel_at_period_end ? 'Автопродление выключено.' : 'Продлится автоматически.'}
      </p>
    </>
  )
}

/** Блок «Оплата» в личном кабинете. */
export default function BillingSection({ billing, discipline }) {
  const { catalog, subscriptions, payments, loading, busy, error, notice, checkout, portal } = billing
  if (loading) return null

  const membership = liveSubscription(subscriptions, 'membership')
  // 'both' — показываем оба направления.
  const mine = (p) => !p.discipline || discipline === 'both' || p.discipline === discipline
  const memberships = catalog.filter((p) => p.kind === 'membership' && mine(p))
  const singles = catalog.filter((p) => p.kind === 'single' && mine(p))
  const hasHistory = subscriptions.length > 0 || payments.length > 0
  const titles = Object.fromEntries(catalog.map((p) => [p.id, p.title]))

  return (
    <section className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label">Оплата</p>
          {membership ? (
            <>
              <h2 className="text-2xl">{membership.product?.title}</h2>
              <div className="mt-1">
                <SubscriptionStatus sub={membership} />
              </div>
            </>
          ) : (
            <h2 className="text-2xl">Абонемент не оплачен</h2>
          )}
        </div>
        {membership && <span className="rounded border border-accent px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent">Активен</span>}
      </div>

      {notice && <p className="rounded-md border border-accent/60 bg-accent/10 p-3 text-sm" role="status">{notice}</p>}
      {error && <p className="rounded-md border border-accent p-3 text-sm text-accent" role="alert">{error}</p>}

      {!membership && memberships.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {memberships.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={Boolean(busy)}
              onClick={() => checkout(p.id)}
              className="btn-primary flex min-h-14 flex-col items-center justify-center !py-2 disabled:opacity-60"
            >
              <span>{busy === p.id ? 'Переход к оплате…' : `${p.title.replace('Абонемент ', '')} · ${formatPrice(p.amount_cents, p.currency)}/мес`}</span>
              <span className="text-[11px] normal-case tracking-normal opacity-80">абонемент, автопродление</span>
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
              {busy === p.id ? 'Переход…' : `${p.title} · ${formatPrice(p.amount_cents, p.currency)}`}
            </button>
          ))}
        </div>
      )}

      {hasHistory && (
        <>
          {payments.length > 0 && (
            <ul className="divide-y divide-line border-t border-line text-sm">
              {payments.slice(0, 5).map((p) => (
                <li key={p.id} className="flex justify-between gap-3 py-2">
                  <span className="truncate text-neutral-300">
                    {titles[p.product_id] ?? 'Оплата'} · {formatDay(p.created_at)}
                  </span>
                  <span className={p.status === 'paid' ? '' : 'text-accent'}>
                    {p.status === 'failed' ? 'не прошла' : p.status === 'refunded' ? 'возврат' : formatPrice(p.amount_cents, p.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={portal}
            disabled={Boolean(busy)}
            className="text-sm text-neutral-400 underline-offset-4 hover:text-white hover:underline disabled:opacity-60"
          >
            {busy === 'portal' ? 'Открываем…' : 'Управление оплатой: карта, счета, отмена подписки'}
          </button>
        </>
      )}

      <p className="text-xs text-neutral-500">Оплата картой через Stripe. Цены указаны с НДС. Первая тренировка — бесплатно.</p>
    </section>
  )
}
