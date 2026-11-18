import { Navigate, useLocation } from 'react-router-dom'

// На вход — и после входа обратно туда, куда человек шёл (Login читает ?next=).
export default function LoginRedirect() {
  const { pathname, search } = useLocation()
  return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />
}
