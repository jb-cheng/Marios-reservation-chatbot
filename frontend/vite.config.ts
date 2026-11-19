import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  appType: 'mpa',
  build: {
    rolldownOptions: {
      input: {
        reservations: fileURLToPath(new URL('./index.html', import.meta.url)),
        story: fileURLToPath(new URL('./our-story/index.html', import.meta.url)),
        menu: fileURLToPath(new URL('./the-menu/index.html', import.meta.url)),
        experience: fileURLToPath(new URL('./the-experience/index.html', import.meta.url)),
        chat: fileURLToPath(new URL('./chat.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // One origin in development, so there is no CORS configuration and no
    // credentials mode to get wrong. The backend runs on 8000.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
