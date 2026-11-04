import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'

// Пускает на страницу только тренера (profiles.role = 'admin').
// Это защита интерфейса; настоящая защита данных — RLS и проверка is_admin() в SQL-функциях.
export default function AdminRoute({ children }) {
  const { user, profile, loading } = useAuth()

  if (loading || (user && !profile)) {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-line border-t-accent" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (profile.role !== 'admin') return <Navigate to="/dashboard" replace />
  return children
}
