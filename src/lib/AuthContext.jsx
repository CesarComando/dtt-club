import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabaseClient.js'
import { getAvatarUrl } from './auth.js'

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
    if (pErr) {
      setError('Не удалось загрузить профиль: ' + pErr.message)
      setProfile(null)
      return
    }
    const avatarSignedUrl = p?.avatar_url ? await getAvatarUrl(p.avatar_url) : null
    setProfile(p ? { ...p, phone: c?.phone ?? null, avatarSignedUrl } : null)
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadProfile(data.session?.user.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      // Профиль перезагружаем только при смене пользователя (не на каждом обновлении токена).
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // setTimeout: Supabase не рекомендует await-запросы прямо внутри колбэка.
        setTimeout(() => loadProfile(newSession?.user.id), 0)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut()
  }

  const refreshProfile = (userId) => loadProfile(userId ?? session?.user.id)

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading, error, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth должен вызываться внутри <AuthProvider>')
  return ctx
}
