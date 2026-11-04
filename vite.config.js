import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base: './' — относительные пути, чтобы сборка работала на GitHub Pages
// по адресу https://<user>.github.io/<repo>/ без привязки к имени репозитория.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
})
