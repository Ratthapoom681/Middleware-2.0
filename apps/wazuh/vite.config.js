import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  base: '/wazuh/',
  plugins: [react()],
  resolve: {
    alias: {
      '@middleware/time': fileURLToPath(new URL('../../packages/time/index.js', import.meta.url)),
      '@middleware/ui': fileURLToPath(new URL('../../packages/ui/index.js', import.meta.url)),
    },
  },
  server: {
    port: 5175,
    fs: {
      allow: [fileURLToPath(new URL('../../', import.meta.url))],
    },
  }
})
