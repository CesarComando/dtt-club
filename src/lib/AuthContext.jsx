import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabaseClient.js'
import { getAvatarUrl } from './auth.js'
import { t } from './i18n.jsx'
import { clearCache, isNetworkError, readCache, saveCache, setCacheUser } from './offline.js'
import { flush, startOutbox } from './outbox.js'

// Кто входил последним на этом телефоне — чтобы без интернета открыть его кабинет.
const LAST_USER = 'dtt-last-user'
const readLastUser = () => {
  try {
    return JSON.parse(localStorage.getItem(LAST_USER))
  } catch {
    return null
  }
}
const writeLastUser = (u) => {
  try {
    if (u) localStorage.setItem(LAST_USER, JSON.stringify({ id: u.id, email: u.email ?? null }))
    else localStorage.removeItem(LAST_USER)
  } catch {
    /* нет доступа к памяти */
  }
}
let outboxStarted = false

const AuthContext = createContext(null)

/**
 * Хранит текущую сессию Supabase и профиль спортсмена.
 * profile = строка из public.profiles + phone (из profile_contacts) + avatarSignedUrl.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState('')
  const [offlineUser, setOfflineUser] = useState(null) // без сети: последний вошедший, данные из памяти телефона

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      return
    }
    setError('')
    const [{ data: p, error: pErr }, { data: c }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('profile_contacts').select('phone').eq('id', userId).maybeSingle(),
    ])
    setCacheUser(userId)
    if (pErr) {
      // Нет сети — показываем сохранённый профиль
      const saved = isNetworkError(pErr) ? readCache('profile', userId) : null
      if (saved) return setProfile(saved.data)
      setError(t('Не удалось загрузить профиль: ') + pErr.message)
      setProfile(null)
      return
    }
    const avatarSignedUrl = p?.avatar_url ? await getAvatarUrl(p.avatar_url) : null
    const next = p ? { ...p, phone: c?.phone ?? null, avatarSignedUrl } : null
    if (next) saveCache('profile', { ...next, avatarSignedUrl: null }, userId) // ссылка на фото всё равно истечёт
    setProfile(next)
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return

    const restore = async () => {
      const { data, error: sErr } = await supabase.auth.getSession()
      if (!data.session && (isNetworkError(sErr) || !navigator.onLine)) {
        // Токен истёк, а обновить его без интернета нельзя: открываем сохранённый кабинет.
        // Сессия при этом не потеряна — вернётся сеть, и вход восстановится сам.
        const last = readLastUser()
        const saved = last && readCache('profile', last.id)
        if (saved) {
          setCacheUser(last.id)
          setOfflineUser(last)
          setProfile(saved.data)
          setLoading(false)
          return
        }
      }
      setOfflineUser(null)
      setSession(data.session)
      if (data.session) writeLastUser(data.session.user)
      await loadProfile(data.session?.user.id)
      setLoading(false)
    }
    restore()
    // Сеть вернулась после офлайн-входа — обновляем сессию и профиль
    const onOnline = () => setOfflineUser((u) => (u ? (restore(), u) : u))
    window.addEventListener('online', onOnline)

    if (!outboxStarted) {
      outboxStarted = true
      startOutbox(() => readLastUser()?.id)
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      if (newSession) {
        setOfflineUser(null)
        writeLastUser(newSession.user)
      }
      if (event === 'SIGNED_IN') setTimeout(() => flush(newSession?.user.id), 0)
      // Профиль перезагружаем только при смене пользователя (не на каждом обновлении токена).
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // setTimeout: Supabase не рекомендует await-запросы прямо внутри колбэка.
        setTimeout(() => loadProfile(newSession?.user.id), 0)
      }
    })
    return () => {
      sub.subscription.unsubscribe()
      window.removeEventListener('online', onOnline)
    }
  }, [loadProfile])

  const signOut = async () => {
    // Выход стирает сохранённые на телефоне данные кабинета
    clearCache()
    writeLastUser(null)
    setOfflineUser(null)
    setCacheUser(null)
    if (supabase) await supabase.auth.signOut().catch(() => {})
    setProfile(null)
  }

  const refreshProfile = (userId) => loadProfile(userId ?? session?.user.id)

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? offlineUser, offline: Boolean(offlineUser), profile, loading, error, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth должен вызываться внутри <AuthProvider>')
  return ctx
}
