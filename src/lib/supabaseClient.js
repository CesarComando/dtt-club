import { createClient } from '@supabase/supabase-js'
import { lang, tData } from './i18n.jsx'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Если ключи ещё не вставлены в .env — приложение не падает,
// а формы показывают понятную ошибку (см. isSupabaseConfigured).
export const isSupabaseConfigured = Boolean(url && anonKey)

// Латышский интерфейс: ошибки базы и Edge Functions приходят по-русски
// (raise exception … / { error: '…' }) — переводим их по словарю прямо в ответе.
// Английские ошибки входа не трогаем: их переводит translateAuthError.
const CYR = /[А-Яа-яЁё]/
async function translatingFetch(input, init) {
  const res = await fetch(input, init)
  if (res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return res
  try {
    const body = await res.clone().json()
    let changed = false
    for (const k of ['message', 'error', 'msg', 'details', 'hint']) {
      if (typeof body?.[k] === 'string' && CYR.test(body[k])) {
        const tr = tData(body[k])
        if (tr !== body[k]) {
          body[k] = tr
          changed = true
        }
      }
    }
    if (!changed) return res
    return new Response(JSON.stringify(body), { status: res.status, statusText: res.statusText, headers: res.headers })
  } catch {
    return res
  }
}

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, lang === 'lv' ? { global: { fetch: translatingFetch } } : undefined)
  : null

if (!isSupabaseConfigured) {
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY не заданы в .env')
}

export const AVATARS_BUCKET = 'avatars'
