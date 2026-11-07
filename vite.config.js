import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// base: './' — относительные пути: сборка работает и на GitHub Pages
// (app.daugavpilstopteam.lv), и внутри нативного приложения Capacitor.
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: {
        // Библиотеки — отдельными файлами: они меняются редко, и после обновления
        // приложения телефон скачивает заново только код клуба, а не React и Supabase.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) return 'react'
          if (id.includes('@supabase')) return 'supabase'
        },
      },
    },
  },
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
        // Большие иконки (≈430 КБ) нужны только при установке — браузер берёт их из манифеста сам.
        globIgnores: ['**/pwa-512x512.png', '**/maskable-icon-512x512.png'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Новая версия включается сама, не дожидаясь сигнала от страницы:
        // иначе старая открытая страница (без нового кода обновления) держала её в «ожидании».
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
})
