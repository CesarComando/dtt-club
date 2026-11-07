import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, Link } from 'react-router-dom'
import Navbar from './components/Navbar.jsx'
import AdminRoute from './components/AdminRoute.jsx'
import Home from './pages/Home.jsx'
import InstallApp from './components/InstallApp.jsx'
import { t } from './lib/i18n.jsx'
// Страницы грузятся отдельно — первое открытие быстрее (главная не тянет код кабинета и CRM).
const Login = lazy(() => import('./pages/Login.jsx'))
const Register = lazy(() => import('./pages/Register.jsx'))
const loadDashboard = () => import('./pages/Dashboard.jsx')
const Dashboard = lazy(loadDashboard)
const AskClub = lazy(() => import('./components/AskClub.jsx'))
// Кабинет — самая частая страница: подгружаем его заранее, когда браузер свободен.
if (typeof window !== 'undefined') (window.requestIdleCallback ?? ((cb) => setTimeout(cb, 1500)))(() => loadDashboard())
const Admin = lazy(() => import('./pages/Admin.jsx'))
const Privacy = lazy(() => import('./pages/Privacy.jsx'))
const Checkin = lazy(() => import('./pages/Checkin.jsx'))
const Invite = lazy(() => import('./pages/Invite.jsx'))
const Diary = lazy(() => import('./pages/Diary.jsx'))
const AdminStudent = lazy(() => import('./pages/AdminStudent.jsx'))
const Gallery = lazy(() => import('./pages/Gallery.jsx'))
const Articles = lazy(() => import('./pages/Articles.jsx'))
const Article = lazy(() => import('./pages/Article.jsx'))
const ArticleEdit = lazy(() => import('./pages/ArticleEdit.jsx'))
const Trial = lazy(() => import('./pages/Trial.jsx'))

export default function App() {
  return (
    <div className="min-h-dvh">
      <Navbar />
      <Suspense fallback={null}>
        <AskClub />
      </Suspense>
      {/* pb-24 — место под нижний таб-бар на мобильных */}
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-24 md:pt-24 md:pb-12">
        <InstallApp />
        <Suspense
          fallback={
            <div className="py-16 text-center">
              <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-line border-t-accent" />
            </div>
          }
        >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/articles" element={<Articles />} />
          <Route path="/articles/new" element={<AdminRoute adminOnly><ArticleEdit /></AdminRoute>} />
          <Route path="/articles/:id" element={<Article />} />
          <Route path="/articles/:id/edit" element={<AdminRoute adminOnly><ArticleEdit /></AdminRoute>} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/diary" element={<Diary />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/privacy" element={<Privacy />} />
          {/* Заявка на бесплатную пробную тренировку — без входа (кнопка на сайте клуба) */}
          <Route path="/trial" element={<Trial />} />
          {/* QR-чекин: телефон ученика открывает ссылку из QR на экране тренера */}
          <Route path="/checkin/:token" element={<Checkin />} />
          <Route path="/invite/:token" element={<Invite />} />
          {/* Скрытая панель тренера: нет ссылки в навигации, пускает только role = 'admin'. */}
          <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
          <Route path="/admin/member/:id" element={<AdminRoute adminOnly><AdminStudent kind="member" /></AdminRoute>} />
          <Route path="/admin/athlete/:id" element={<AdminRoute adminOnly><AdminStudent kind="athlete" /></AdminRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        <footer className="mt-12 flex flex-wrap justify-center gap-x-4 gap-y-2 border-t border-line pt-4 text-center text-xs text-neutral-500">
          {/* Сайт клуба (3 языка, для Google) — в том же стиле; оттуда ведёт кнопка «Войти» сюда. */}
          <a href="https://daugavpilstopteam.lv" target="_blank" rel="noopener" className="hover:text-white">
            {t('Сайт клуба')} · daugavpilstopteam.lv
          </a>
          <Link to="/privacy" className="hover:text-white">{t('Политика конфиденциальности')}</Link>
        </footer>
      </main>
    </div>
  )
}
