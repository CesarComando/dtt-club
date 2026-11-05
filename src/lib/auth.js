import { createClient } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured, AVATARS_BUCKET } from './supabaseClient.js'

// Вход по номеру телефона: Supabase Auth требует email,
// поэтому телефон превращается в технический адрес <цифры>@dtt.local.
const EMAIL_DOMAIN = 'dtt.local'

// '+371 20 000 000' / '20000000' → '37120000000'
// Детский логин: телефон родителя + «-номер» ('27167013-1' → '37127167013-1', слой 24).
export function normalizePhone(raw) {
  // Детский — только «полный номер-1..99» (номер, набранный через дефисы, сюда не попадает)
  const kid = String(raw).trim().match(/^([^-]*\d)\s*-\s*(\d{1,2})$/)
  if (kid && normalizePhone(kid[1]).length >= 10) return `${normalizePhone(kid[1])}-${Number(kid[2])}`
  let digits = String(raw).replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  // Латвийский номер без кода страны: 8 цифр, начинается с 2 (моб.) или 6 (стац.)
  if (digits.length === 8 && /^[26]/.test(digits)) digits = '371' + digits
  return digits
}

export const phoneToEmail = (phone) => `${normalizePhone(phone)}@${EMAIL_DOMAIN}`

function ensureConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase не настроен: заполните VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в .env')
  }
}

// Уменьшает фото с камеры (часто 3–8 МБ) до ~800px JPEG перед загрузкой.
export async function compressImage(file, maxSize = 800, quality = 0.85) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось обработать фото'))), 'image/jpeg', quality),
  )
}

/**
 * Регистрация спортсмена:
 * 1) auth.signUp — триггер в БД сам создаёт строку в profiles из metadata;
 * 2) загрузка селфи в приватный бакет avatars/<user_id>/selfie.jpg;
 * 3) запись пути к фото в profiles.avatar_url.
 */
export async function registerAthlete({ firstName, lastName, phone, password, discipline, selfie }) {
  ensureConfigured()
  const normalizedPhone = normalizePhone(phone)

  const { data, error } = await supabase.auth.signUp({
    email: phoneToEmail(phone),
    password,
    options: {
      data: { first_name: firstName.trim(), last_name: lastName.trim(), phone: normalizedPhone, discipline },
    },
  })
  if (error) throw translateAuthError(error)

  // Без сессии (включено подтверждение email) загрузить фото нельзя — RLS не пустит.
  if (!data.session) {
    throw new Error('Аккаунт создан, но требуется подтверждение email. Отключите «Confirm email» в Supabase (см. SUPABASE_SETUP.md).')
  }

  const userId = data.user.id
  const path = `${userId}/selfie.jpg`
  const blob = await compressImage(selfie)

  const { error: uploadError } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (uploadError) throw new Error('Аккаунт создан, но фото не загрузилось: ' + uploadError.message)

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ avatar_url: path })
    .eq('id', userId)
  if (profileError) throw new Error('Фото загружено, но профиль не обновился: ' + profileError.message)

  return data.user
}

/**
 * Родитель добавляет ребёнка (слой 24). Аккаунт создаётся во временном клиенте без сохранения
 * сессии — родитель остаётся в своём аккаунте. Логин ребёнка: <телефон родителя>-<n>;
 * триггер в базе сам привязывает ребёнка к родителю по этому логину.
 * Возвращает логин для входа ребёнка.
 */
export async function createChildAccount({ parentPhone, firstName, lastName, discipline, password, photo }) {
  ensureConfigured()
  const base = normalizePhone(parentPhone ?? '')
  if (!/^\d{8,15}$/.test(base)) throw new Error('В вашем профиле нет номера телефона — добавить ребёнка нельзя.')
  const tmp = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'dtt-child-tmp' },
  })
  const blob = photo ? await compressImage(photo) : null
  // Свободный номер: 1, 2, 3… (занят — пробуем следующий)
  for (let n = 1; n <= 20; n++) {
    const login = `${base}-${n}`
    const { data, error } = await tmp.auth.signUp({
      email: `${login}@${EMAIL_DOMAIN}`,
      password,
      options: { data: { first_name: firstName.trim(), last_name: lastName.trim(), discipline } },
    })
    if (error) {
      if (/already registered|already been registered/i.test(error.message)) continue
      throw translateAuthError(error)
    }
    if (!data.session) throw new Error('Аккаунт создан, но требуется подтверждение email (Confirm email в Supabase).')
    if (blob) {
      const path = `${data.user.id}/selfie.jpg`
      const up = await tmp.storage.from(AVATARS_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true })
      if (!up.error) await tmp.from('profiles').update({ avatar_url: path }).eq('id', data.user.id)
    }
    await tmp.auth.signOut()
    return login
  }
  throw new Error('Не удалось подобрать логин для ребёнка.')
}

export async function unlinkChild(childId) {
  const { error } = await supabase.rpc('unlink_child', { p_child: childId })
  if (error) throw error
}

export async function signInWithPhone(phone, password) {
  ensureConfigured()
  const { data, error } = await supabase.auth.signInWithPassword({ email: phoneToEmail(phone), password })
  if (error) throw translateAuthError(error)
  return data.user
}

// Бакет приватный, поэтому для показа фото нужна временная подписанная ссылка.
export async function getAvatarUrl(path, expiresIn = 3600) {
  if (!path || !isSupabaseConfigured) return null
  const { data, error } = await supabase.storage.from(AVATARS_BUCKET).createSignedUrl(path, expiresIn)
  return error ? null : data.signedUrl
}

function translateAuthError(error) {
  const msg = error.message || ''
  if (/already registered|already been registered/i.test(msg)) return new Error('Этот номер уже зарегистрирован. Войдите.')
  if (/Аккаунт родителя не найден|Database error saving new user/i.test(msg))
    return new Error('Аккаунт родителя не найден — сначала родитель регистрируется сам.')
  if (/invalid login credentials/i.test(msg)) return new Error('Неверный номер телефона или пароль.')
  if (/password should be at least/i.test(msg)) return new Error('Пароль слишком короткий (минимум 6 символов).')
  if (/rate limit/i.test(msg)) return new Error('Слишком много попыток. Подождите минуту.')
  return new Error(msg)
}
