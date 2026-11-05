import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// base: './' — относительные пути: сборка работает и на GitHub Pages
// (app.daugavpilstopteam.lv), и внутри нативного приложения Capacitor.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Новая версия ставится сама и страница перезагружается (src/lib/pwa.js проверяет
      // обновления при открытии и при возврате в приложение).
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['apple-touch-icon.png', 'favicon-64x64.png'],
      manifest: {
        name: 'Daugavpils Top Team',
        short_name: 'DTT App',
        description: 'Клубное приложение Daugavpils Top Team & Grappling Team: расписание, ранги, посещаемость.',
        lang: 'ru',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        // Тёмная тема клуба: статус-бар и экран загрузки чёрные, акцент красный — в иконке.
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Кэшируем только файлы самого приложения (JS/CSS/иконки).
        // Запросы к Supabase (профили, фото, вход) НЕ кэшируются — всегда свежие данные.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
