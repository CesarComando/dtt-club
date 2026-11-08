import { useCallback, useEffect, useMemo, useState } from 'react'
import { allOrders, batchText, imageUrl, loadCosts, loadShop, money, saveProduct, setStatus, uploadProductImage } from '../lib/shop.js'
import { ORDER_STATUS, itemLine } from '../pages/Shop.jsx'
import { t } from '../lib/i18n.jsx'

// Тренер: заказы магазина (пачка для GERA → пришло → выдано) и товары.
export default function AdminShop() {
  const [orders, setOrders] = useState(null)
  const [shop, setShop] = useState(null)
  const [costs, setCosts] = useState({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    allOrders().then(setOrders).catch((e) => setError(e.message))
    loadShop().then(setShop).catch((e) => setError(e.message))
    loadCosts().then(setCosts).catch(() => {})
  }, [])
  useEffect(() => load(), [load])

  const by = useMemo(() => {
    const g = { awaiting_payment: [], paid: [], ordered: [], arrived: [], handed: [] }
    for (const o of orders ?? []) g[o.status]?.push(o)
    return g
  }, [orders])

  // Доход с наценки за всё время: оплачено минус розница GERA (по оплаченным/выданным заказам)
  const margin = useMemo(() => {
    let sum = 0
    for (const o of orders ?? []) {
      if (o.status === 'awaiting_payment') continue
      for (const it of o.items) {
        const c = costs[it.product_id]
        const cost = it.variant === 'kid' ? c?.cost_kid_cents : c?.cost_cents
        if (cost != null) sum += (it.price_cents - cost) * it.qty
      }
    }
    return sum
  }, [orders, costs])

  const move = async (list, status, msg) => {
    setBusy(true)
    setError('')
    try {
      await setStatus(list.map((o) => o.id), status)
      setNotice(msg)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(t('Скопировано — вставьте в WhatsApp GERA.'))
    } catch {
      setNotice(t('Не удалось скопировать — выделите текст вручную.'))
    }
  }

  if (!orders) return <p className="card text-neutral-400">{t('Загрузка…')}</p>
  const batch = batchText(by.paid)

  return (
    <div className="space-y-5">
      {error && <p className="rounded-md border border-accent p-3 text-sm text-accent">{error}</p>}
      {notice && <p className="rounded-md border border-emerald-500/50 p-3 text-sm text-emerald-300">{notice}</p>}

      <section className="card grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
        {[
          [by.paid.length, t('ждут отправки')],
          [by.ordered.length, t('шьют в GERA')],
          [by.arrived.length, t('выдать')],
          [money(margin), t('доход с наценки')],
        ].map(([n, label]) => (
          <div key={label}>
            <p className="font-display text-2xl">{n}</p>
            <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
          </div>
        ))}
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg">{t('Оплачено — отправить в GERA')}</h2>
        {by.paid.length ? (
          <>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-ink p-3 text-sm">{batch}</pre>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-outline" onClick={() => copy(batch)}>
                {t('Скопировать для GERA')}
              </button>
              <button type="button" disabled={busy} className="btn-primary disabled:opacity-60" onClick={() => move(by.paid, 'ordered', t('Отмечено: заказано в GERA'))}>
                {t('Отправил в GERA')}
              </button>
            </div>
            <OrderList orders={by.paid} />
          </>
        ) : (
          <p className="text-sm text-neutral-400">{t('Новых оплаченных заказов нет.')}</p>
        )}
      </section>

      {by.ordered.length > 0 && (
        <section className="card space-y-3">
          <h2 className="text-lg">{t('Заказано в GERA')}</h2>
          <button type="button" disabled={busy} className="btn-outline disabled:opacity-60" onClick={() => move(by.ordered, 'arrived', t('Отмечено: пришло'))}>
            {t('Всё пришло')}
          </button>
          <OrderList orders={by.ordered} action={[t('Пришло'), (o) => move([o], 'arrived', t('Отмечено: пришло'))]} />
        </section>
      )}

      {by.arrived.length > 0 && (
        <section className="card space-y-3">
          <h2 className="text-lg">{t('Пришло — выдать на тренировке')}</h2>
          <OrderList orders={by.arrived} action={[t('Выдал'), (o) => move([o], 'handed', t('Отмечено: выдано'))]} />
        </section>
      )}

      {by.awaiting_payment.length > 0 && (
        <section className="card space-y-3">
          <h2 className="text-lg">{t('Ждут оплаты')}</h2>
          <p className="text-xs text-neutral-500">{t('В GERA не уходят, пока не оплачены.')}</p>
          <OrderList orders={by.awaiting_payment} />
        </section>
      )}

      {shop && <Products shop={shop} costs={costs} onSaved={load} />}
    </div>
  )
}

function OrderList({ orders, action }) {
  return (
    <ul className="divide-y divide-line text-sm">
      {orders.map((o) => (
        <li key={o.id} className="flex items-start justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="font-semibold">
              №{o.id} · {o.who} · {money(o.total_cents)}
            </p>
            <ul className="text-neutral-300">
              {o.items.map((it, i) => (
                <li key={i}>
                  {itemLine(it)} × {it.qty}
                </li>
              ))}
            </ul>
            {o.note && <p className="text-xs text-neutral-500">«{o.note}»</p>}
            <p className={`text-xs ${ORDER_STATUS[o.status]?.[1] ?? ''}`}>{t(ORDER_STATUS[o.status]?.[0] ?? o.status)}</p>
          </div>
          {action && (
            <button type="button" className="shrink-0 rounded border border-line px-2 py-1 text-xs hover:border-accent" onClick={() => action[1](o)}>
              {action[0]}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

const euro = (cents) => (cents == null ? '' : String(cents / 100).replace('.', ','))
const cents = (v) => {
  const n = Math.round(Number(String(v).replace(',', '.')) * 100)
  return Number.isFinite(n) && n > 0 ? n : null
}

function Products({ shop, costs, onSaved }) {
  const [adding, setAdding] = useState(false)
  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg">{t('Товары и цены')}</h2>
        <button type="button" className="text-sm font-semibold text-accent hover:underline" onClick={() => setAdding((a) => !a)}>
          {adding ? t('Отмена') : `＋ ${t('Свой товар')}`}
        </button>
      </div>
      {adding && <NewMerch onSaved={() => (setAdding(false), onSaved())} />}
      <ul className="divide-y divide-line">
        {shop.products.map((p) => (
          <ProductEdit key={p.id} p={p} cost={costs[p.id]} onSaved={onSaved} />
        ))}
      </ul>
    </section>
  )
}

function ProductEdit({ p, cost, onSaved }) {
  const [price, setPrice] = useState(euro(p.price_cents))
  const [kid, setKid] = useState(euro(p.price_kid_cents))
  const [stock, setStock] = useState(p.stock ?? '')
  const [err, setErr] = useState('')
  const dirty = price !== euro(p.price_cents) || kid !== euro(p.price_kid_cents) || String(stock) !== String(p.stock ?? '')
  const save = async (patch = {}) => {
    setErr('')
    const next = {
      ...p,
      price_cents: cents(price) ?? p.price_cents,
      price_kid_cents: p.price_kid_cents == null && !kid ? null : (cents(kid) ?? p.price_kid_cents),
      stock: stock === '' ? null : Math.max(0, parseInt(stock, 10) || 0),
      ...patch,
    }
    try {
      await saveProduct(next)
      onSaved()
    } catch (e) {
      setErr(e.message)
    }
  }
  return (
    <li className={`space-y-1 py-2 text-sm ${p.active ? '' : 'opacity-50'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate">
          {p.brand === 'dtt' && p.image && <img src={imageUrl(p.image)} alt="" className="mr-2 inline h-8 w-8 rounded object-cover" />}
          {p.title}
          {cost?.cost_cents != null && <span className="text-xs text-neutral-500"> · GERA {money(cost.cost_cents)}{cost.cost_kid_cents != null && ` / ${money(cost.cost_kid_cents)}`}</span>}
        </p>
        <button type="button" className="shrink-0 text-xs text-neutral-400 hover:text-white" onClick={() => save({ active: !p.active })}>
          {p.active ? t('Скрыть') : t('Показать')}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          €<input className="input !w-20 !py-1" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        {p.price_kid_cents != null && (
          <label className="flex items-center gap-1 text-neutral-400">
            {t('дет.')} €<input className="input !w-20 !py-1" inputMode="decimal" value={kid} onChange={(e) => setKid(e.target.value)} />
          </label>
        )}
        {p.brand === 'dtt' && (
          <label className="flex items-center gap-1 text-neutral-400">
            {t('остаток')}
            <input className="input !w-16 !py-1" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} />
          </label>
        )}
        {dirty && (
          <button type="button" className="rounded border border-accent px-2 py-1 text-xs hover:bg-accent/15" onClick={() => save()}>
            {t('Сохранить')}
          </button>
        )}
      </div>
      {err && <p className="text-xs text-accent">{err}</p>}
    </li>
  )
}

function NewMerch({ onSaved }) {
  const [f, setF] = useState({ title: '', description: '', price: '', stock: '', sizes: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    const price = cents(f.price)
    if (!f.title.trim() || !price) return setErr(t('Название и цена обязательны'))
    setBusy(true)
    setErr('')
    try {
      const image = file ? await uploadProductImage(file) : null
      await saveProduct({
        id: `dtt_${Date.now().toString(36)}`,
        brand: 'dtt',
        title: f.title.trim(),
        description: f.description.trim() || null,
        price_cents: price,
        sizes: f.sizes.split(',').map((s) => s.trim()).filter(Boolean),
        needs_design: false,
        made_to_order: false,
        stock: f.stock === '' ? null : Math.max(0, parseInt(f.stock, 10) || 0),
        image,
        sort: 500,
      })
      onSaved()
    } catch (e2) {
      setErr(e2.message)
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border border-line p-3">
      <p className="text-sm font-semibold">{t('Свой товар: брелок, аксессуар, мерч')}</p>
      <input className="input" placeholder={t('Название')} value={f.title} onChange={set('title')} maxLength={80} />
      <input className="input" placeholder={t('Описание (необязательно)')} value={f.description} onChange={set('description')} maxLength={200} />
      <div className="grid grid-cols-3 gap-2">
        <input className="input" inputMode="decimal" placeholder={t('Цена, €')} value={f.price} onChange={set('price')} />
        <input className="input" inputMode="numeric" placeholder={t('Сколько есть')} value={f.stock} onChange={set('stock')} />
        <input className="input" placeholder={t('Размеры: S, M, L')} value={f.sizes} onChange={set('sizes')} />
      </div>
      <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
      {err && <p className="text-xs text-accent">{err}</p>}
      <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-60">
        {busy ? '…' : t('Добавить в магазин')}
      </button>
    </form>
  )
}
