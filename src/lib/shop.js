// Магазин (слой 38): форма GERA под заказ и свой мерч клуба.
import { supabase } from './supabaseClient.js'
import { callFunction } from './payments.js'
import { locale } from './i18n.jsx'

const must = ({ data, error }) => {
  if (error) throw error
  return data
}

/** Цена: 31 € или 30,80 € (без «30,8»). */
export const money = (cents) =>
  new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100)

/** Картинка: путь из приложения (shop/…) или публичный бакет shop (свой мерч). */
export function imageUrl(path) {
  if (!path) return null
  if (/^https?:/.test(path)) return path
  if (path.startsWith('shop/')) return `${import.meta.env.BASE_URL}${path}`
  return supabase.storage.from('shop').getPublicUrl(path).data.publicUrl
}

export async function loadShop() {
  const [designs, products] = await Promise.all([
    supabase.from('shop_designs').select('*').order('sort'),
    supabase.from('shop_products').select('*').order('sort'),
  ])
  return { designs: must(designs), products: must(products) }
}

/** Оформить и сразу перейти к оплате картой. items: [{ product_id, design_id, variant, size, qty }] */
export async function placeAndPay(items, note) {
  const rows = must(await supabase.rpc('shop_place_order', { p_items: items, p_note: note || null }))
  const orderId = rows?.[0]?.order_id
  if (!orderId) throw new Error('Не удалось оформить заказ')
  await payOrder(orderId)
}

export async function payOrder(orderId) {
  const { url } = await callFunction('create-checkout', { shop_order_id: orderId })
  window.location.assign(url)
}

export async function myOrders() {
  return must(await supabase.from('shop_orders').select('*').order('created_at', { ascending: false }).limit(30))
}

export async function cancelOrder(id) {
  must(await supabase.rpc('shop_cancel_order', { p_order: id }))
}

// ---- тренер ----
export async function allOrders() {
  const orders = must(
    await supabase.from('shop_orders').select('*').neq('status', 'cancelled').order('created_at', { ascending: false }).limit(300),
  )
  const ids = [...new Set(orders.map((o) => o.user_id))]
  const people = ids.length ? must(await supabase.from('profiles').select('id, first_name, last_name').in('id', ids)) : []
  const name = Object.fromEntries(people.map((p) => [p.id, `${p.first_name} ${p.last_name}`]))
  return orders.map((o) => ({ ...o, who: name[o.user_id] ?? '—' }))
}

export async function setStatus(ids, status) {
  return must(await supabase.rpc('shop_set_status', { p_orders: ids, p_status: status }))
}

export async function loadCosts() {
  const rows = must(await supabase.from('shop_costs').select('*'))
  return Object.fromEntries(rows.map((r) => [r.product_id, r]))
}

export async function saveProduct(p) {
  must(await supabase.from('shop_products').upsert(p))
}

export async function uploadProductImage(file) {
  // Перерисовка стирает EXIF (место съёмки, телефон); оригинал не грузим
  const { compressImage } = await import('./auth.js')
  const body = await compressImage(file, 1200, 0.82)
  const path = `merch/${crypto.randomUUID()}.jpg`
  must(await supabase.storage.from('shop').upload(path, body, { contentType: 'image/jpeg' }))
  return path
}

const VARIANT = { adult: 'взр.', kid: 'дет.' }

/** Текст пачки для GERA: дизайн → вещь → размер × количество. */
export function batchText(orders) {
  const map = new Map()
  for (const o of orders)
    for (const it of o.items) {
      if (it.brand && it.brand !== 'gera') continue
      const key = `${it.design_title ?? '—'}|${it.title}|${VARIANT[it.variant] ?? ''} ${it.size ?? ''}`.trim()
      map.set(key, (map.get(key) ?? 0) + it.qty)
    }
  const lines = []
  let lastDesign = ''
  for (const [key, qty] of [...map.entries()].sort()) {
    const [design, title, size] = key.split('|')
    if (design !== lastDesign) {
      lines.push(`\n${design}:`)
      lastDesign = design
    }
    lines.push(`- ${title}, ${size.trim()} — ${qty} шт.`)
  }
  return `Заказ Daugavpils Top Team / Grappling Team${lines.join('\n')}`.trim()
}
