import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './lib/AuthContext.jsx'
import './index.css'
import { startPwaUpdates } from './lib/pwa.js'

startPwaUpdates()

// Нет меню «Сохранить картинку / видео» (правая кнопка, долгое нажатие) и перетаскивания
// фото на рабочий стол — для всех фото в приложении, в том числе детских.
const isMedia = (e) => e.target instanceof Element && e.target.closest('img, video')
document.addEventListener('contextmenu', (e) => isMedia(e) && e.preventDefault())
document.addEventListener('dragstart', (e) => isMedia(e) && e.preventDefault())

// HashRouter (#/dashboard) — GitHub Pages не умеет отдавать index.html
// на любой путь, поэтому без хеша обновление страницы давало бы 404.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
)
