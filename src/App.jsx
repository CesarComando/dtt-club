import { Routes, Route, Navigate, Link } from 'react-router-dom'
import Navbar from './components/Navbar.jsx'
import AdminRoute from './components/AdminRoute.jsx'
import Home from './pages/Home.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Admin from './pages/Admin.jsx'
import Privacy from './pages/Privacy.jsx'
import Checkin from './pages/Checkin.jsx'
import Invite from './pages/Invite.jsx'
import Diary from './pages/Diary.jsx'
import AdminStudent from './pages/AdminStudent.jsx'
import InstallApp from './components/InstallApp.jsx'
import Gallery from './pages/Gallery.jsx'

export default function App() {
  return (
    <div className="min-h-dvh">
      <Navbar />
      {/* pb-24 — место под нижний таб-бар на мобильных */}
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-24 md:pt-24 md:pb-12">
        <InstallApp />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/diary" element={<Diary />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/privacy" element={<Privacy />} />
          {/* QR-чекин: телефон ученика открывает ссылку из QR на экране тренера */}
          <Route path="/checkin/:token" element={<Checkin />} />
          <Route path="/invite/:token" element={<Invite />} />
          {/* Скрытая панель тренера: нет ссылки в навигации, пускает только role = 'admin'. */}
          <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
          <Route path="/admin/member/:id" element={<AdminRoute adminOnly><AdminStudent kind="member" /></AdminRoute>} />
          <Route path="/admin/athlete/:id" element={<AdminRoute adminOnly><AdminStudent kind="athlete" /></AdminRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <footer className="mt-12 border-t border-line pt-4 text-center text-xs text-neutral-500">
          <Link to="/privacy" className="hover:text-white">Политика конфиденциальности</Link>
        </footer>
      </main>
    </div>
  )
}
