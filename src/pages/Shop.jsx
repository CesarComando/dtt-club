import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { cancelOrder, imageUrl, loadShop, money, myOrders, payOrder, placeAndPay } from '../lib/shop.js'
import { t } from '../lib/i18n.jsx'

// Магазин клуба (слой 38): форма GERA с дизайнами клуба (шьют под заказ) и свой мерч.
export const ORDER_STATUS = {
  awaiting_payment: ['Ждёт оплаты', 'text-amber-400'],
  paid: ['Оплачен — ждёт отправки в GERA', 'text-emerald-400'],
  ordered: ['Заказан в GERA, шьют', 'text-sky-400'],
  arrived: ['Пришёл — заберите на тренировке', 'text-emerald-400'],
  handed: ['Выдан', 'text-neutral-400'],
  cancelled: ['Отменён', 'text-neutral-500'],
}
const VARIANT = { adult: 'взрослый', kid: 'детский' }

const CART_KEY = 'dtt-cart'
const readCart = () => {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) ?? []
  } catch {
    return []
  }
}
const writeCart = (c) => {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(c))
  } catch {
    /* нет памяти — корзина живёт до закрытия вкладки */
  }
}

export function itemLine(it) {
  return [t(it.title), it.design_title, it.variant === 'kid' ? t(VARIANT.kid) : null, it.size].filter(Boolean).join(' · ')
}

export default function Shop() {
  const { user, loading: authLoading } = useAuth()
  const [params, setParams] = useSearchParams()
  const [shop, setShop] = useState(null)
  const [orders, setOrders] = useState([])
  const [error, setError] = useState('')
  const [tab, setTab] = useState('gera')
  const [design, setDesign] = useState(null)
  const [cart, setCart] = useState(readCart)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(null)

  const refresh = useCallback(() => {
    loadShop().then(setShop).catch((e) => setError(e.message))
    myOrders().then(setOrders).catch(() => {})
  }, [])
  useEffect(() => {
    if (user) refresh()
  }, [user, refresh])
  useEffect(() => writeCart(cart), [cart])
  useEffect(() => {
    // Вернулись после оплаты — корзину очищаем
    if (params.get('paid')) setCart([])
  }, [params])

  const gera = useMemo(() => (shop?.products ?? []).filter((p) => p.brand === 'gera'), [shop])
  const merch = useMemo(() => (shop?.products ?? []).filter((p) => p.brand === 'dtt'), [shop])
  const designs = shop?.designs ?? []
  const current = designs.find((d) => d.id === design) ?? null
  const total = cart.reduce((s, it) => s + it.price_cents * it.qty, 0)

  if (authLoading) return <p className="card text-neutral-400">{t('Загрузка…')}</p>
  if (!user) return <Navigate to="/login" replace />

  const add = (product, variant, size, qty) => {
    const d = product.needs_design ? current : null
    const price = variant === 'kid' ? product.price_kid_cents : product.price_cents
    setCart((c) => [
      ...c,
      {
        key: crypto.randomUUID(),
        product_id: product.id,
        title: product.title,
        design_id: d?.id ?? null,
        design_title: d?.title ?? null,
        variant,
        size: size || null,
        qty,
        price_cents: price,
      },
    ])
  }

  const checkout = async () => {
    setBusy(true)
    setError('')
    try {
      await placeAndPay(
        cart.map(({ product_id, design_id, variant, size, qty }) => ({ product_id, design_id, variant, size, qty })),
        note,
      )
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 pb-28">
      <header className="border-l-4 border-accent pl-4">
        <p className="label">{t('Магазин клуба')}</p>
        <h1 className="text-3xl leading-tight">{t('Экипировка и мерч')}</h1>
      </header>

      {params.get('paid') && (
        <div className="rounded-md border border-emerald-500/60 bg-emerald-500/10 p-3 text-sm">
          {t('Спасибо! Оплата прошла — заказ появится ниже. Когда форма придёт, заберёте на тренировке.')}{' '}
          <button type="button" className="underline" onClick={() => setParams({})}>
            {t('Скрыть')}
          </button>
        </div>
      )}
      {error && <p className="rounded-md border border-accent p-3 text-sm text-accent">{error}</p>}

      <div className="flex gap-2">
        {[
          ['gera', t('Форма GERA')],
          ['merch', t('Мерч клуба')],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full border px-4 py-1.5 text-sm ${tab === id ? 'border-accent bg-accent/15 text-white' : 'border-line text-neutral-400'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {!shop ? (
        <p className="card text-neutral-400">{t('Загрузка…')}</p>
      ) : tab === 'gera' ? (
        <>
          <section className="space-y-3">
            <h2 className="text-lg">{t('1. Выберите дизайн')}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {designs.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDesign(d.id)}
                  className={`overflow-hidden rounded-lg border text-left transition ${design === d.id ? 'border-accent ring-2 ring-accent/40' : 'border-line hover:border-neutral-500'}`}
                >
                  <img src={imageUrl(d.images[0])} alt={d.title} loading="lazy" draggable={false} className="aspect-[4/3] w-full bg-white object-contain" />
                  <div className="p-2">
                    <p className="font-display uppercase leading-tight tracking-wide">{d.title}</p>
                    {d.description && <p className="text-xs text-neutral-500">{t(d.description)}</p>}
                  </div>
                </button>
              ))}
            </div>
            {current && current.images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {current.images.map((src) => (
                  <button key={src} type="button" onClick={() => setZoom(src)} className="shrink-0">
                    <img src={imageUrl(src)} alt="" loading="lazy" draggable={false} className="h-28 rounded-md bg-white object-contain" />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg">{t('2. Выберите вещь')}</h2>
            {!current && <p className="text-sm text-neutral-400">{t('Сначала выберите дизайн — его напечатают на любой вещи из списка.')}</p>}
            <ul className="space-y-2">
              {gera.map((p) => (
                <ProductRow key={p.id} product={p} disabled={!current} onAdd={add} />
              ))}
            </ul>
            <p className="text-xs text-neutral-500">
              {t('Форму шьют под заказ. Заказы отправляем в GERA пачкой раз в месяц, после оплаты. Размеры — по таблице GERA, если сомневаетесь — спросите тренера.')}
            </p>
          </section>
        </>
      ) : merch.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {merch.map((p) => (
            <MerchCard key={p.id} product={p} onAdd={add} />
          ))}
        </ul>
      ) : (
        <p className="card text-neutral-400">{t('Скоро: брелоки, аксессуары и другой мерч клуба.')}</p>
      )}

      {orders.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg">{t('Мои заказы')}</h2>
          {orders.map((o) => {
            const [label, cls] = ORDER_STATUS[o.status] ?? [o.status, '']
            return (
              <div key={o.id} className="card space-y-1 !p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-semibold">
                    {t('Заказ №{n}', { n: o.id })} · {money(o.total_cents)}
                  </p>
                  <span className={`text-xs ${cls}`}>{t(label)}</span>
                </div>
                <ul className="text-sm text-neutral-300">
                  {o.items.map((it, i) => (
                    <li key={i}>
                      {itemLine(it)} × {it.qty}
                    </li>
                  ))}
                </ul>
                {o.status === 'awaiting_payment' && (
                  <div className="flex gap-3 pt-1 text-sm">
                    <button type="button" className="font-semibold text-accent hover:underline" onClick={() => payOrder(o.id).catch((e) => setError(e.message))}>
                      {t('Оплатить')}
                    </button>
                    <button type="button" className="text-neutral-400 hover:text-white" onClick={() => cancelOrder(o.id).then(refresh).catch((e) => setError(e.message))}>
                      {t('Отменить')}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </section>
      )}

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-30 px-3 sm:bottom-4">
          <div className="mx-auto max-w-2xl space-y-2 rounded-lg border border-accent/60 bg-panel p-3 shadow-2xl">
            <p className="label">{t('Корзина')}</p>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {cart.map((it) => (
                <li key={it.key} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {itemLine(it)} × {it.qty}
                  </span>
                  <span className="shrink-0">
                    {money(it.price_cents * it.qty)}{' '}
                    <button type="button" aria-label={t('Убрать')} className="ml-1 text-neutral-500 hover:text-accent" onClick={() => setCart((c) => c.filter((x) => x.key !== it.key))}>
                      ✕
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <input className="input !py-1.5 text-sm" maxLength={300} placeholder={t('Комментарий к заказу (необязательно): имя на форме, рост…')} value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="button" disabled={busy} onClick={checkout} className="btn-primary w-full disabled:opacity-60">
              {busy ? t('Переход к оплате…') : t('Оплатить {amount}', { amount: money(total) })}
            </button>
          </div>
        </div>
      )}

      {zoom && (
        <button type="button" className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setZoom(null)} aria-label={t('Закрыть')}>
          <img src={imageUrl(zoom)} alt="" draggable={false} className="max-h-full max-w-full bg-white object-contain" />
        </button>
      )}

      <p className="text-center text-xs text-neutral-500">
        <Link to="/dashboard" className="hover:text-white">
          ← {t('В кабинет')}
        </Link>
      </p>
    </div>
  )
}

function Picker({ product, onAdd, disabled }) {
  const [variant, setVariant] = useState('adult')
  const [size, setSize] = useState('')
  const [qty, setQty] = useState(1)
  const sizes = variant === 'kid' ? product.kid_sizes : product.sizes
  const price = variant === 'kid' ? product.price_kid_cents : product.price_cents
  const ready = !disabled && (!sizes.length || size)
  return (
    <div className="space-y-2 pt-2">
      {product.price_kid_cents && (
        <div className="flex gap-2">
          {['adult', 'kid'].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setVariant(v)
                setSize('')
              }}
              className={`rounded-full border px-3 py-1 text-xs ${variant === v ? 'border-accent bg-accent/15 text-white' : 'border-line text-neutral-400'}`}
            >
              {v === 'adult' ? t('Взрослый') : t('Детский')}
            </button>
          ))}
        </div>
      )}
      {sizes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sizes.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              className={`min-w-11 rounded border px-2 py-1 text-sm ${size === s ? 'border-accent bg-accent/15 text-white' : 'border-line text-neutral-300'}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded border border-line">
          <button type="button" className="px-3 py-1" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="−">
            −
          </button>
          <span className="w-6 text-center">{qty}</span>
          <button type="button" className="px-3 py-1" onClick={() => setQty((q) => Math.min(10, q + 1))} aria-label="+">
            +
          </button>
        </div>
        <button
          type="button"
          disabled={!ready}
          onClick={() => {
            onAdd(product, variant, size, qty)
            setQty(1)
          }}
          className="btn-primary flex-1 !py-2 disabled:opacity-50"
        >
          {t('В корзину')} · {money(price * qty)}
        </button>
      </div>
    </div>
  )
}

function ProductRow({ product, onAdd, disabled }) {
  const [open, setOpen] = useState(false)
  return (
    <li className={`card !p-3 ${open ? 'border-accent/60' : ''}`}>
      <button type="button" className="flex w-full items-baseline justify-between gap-3 text-left" onClick={() => setOpen((o) => !o)}>
        <span>{t(product.title)}</span>
        <span className="shrink-0 text-sm">
          <b>{money(product.price_cents)}</b>
          {product.price_kid_cents && <span className="text-neutral-400"> · {t('дет.')} {money(product.price_kid_cents)}</span>}
        </span>
      </button>
      {open && <Picker product={product} onAdd={onAdd} disabled={disabled} />}
    </li>
  )
}

function MerchCard({ product, onAdd }) {
  const [open, setOpen] = useState(false)
  const soldOut = product.stock === 0
  return (
    <li className="card space-y-2 !p-3">
      {product.image && <img src={imageUrl(product.image)} alt={product.title} loading="lazy" draggable={false} className="aspect-square w-full rounded-md object-cover" />}
      <p className="font-semibold leading-tight">{product.title}</p>
      {product.description && <p className="text-xs text-neutral-400">{product.description}</p>}
      <p className="text-sm">
        <b>{money(product.price_cents)}</b>
        {product.stock != null && <span className="text-neutral-500"> · {soldOut ? t('нет в наличии') : t('осталось {n}', { n: product.stock })}</span>}
      </p>
      {!soldOut &&
        (open ? (
          <Picker product={product} onAdd={onAdd} />
        ) : (
          <button type="button" className="btn-outline w-full !py-1.5 text-sm" onClick={() => setOpen(true)}>
            {t('Выбрать')}
          </button>
        ))}
    </li>
  )
}
