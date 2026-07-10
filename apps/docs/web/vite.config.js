import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: '/docs/',
  plugins: [react()],
  resolve: {
    alias: {
      '@middleware/time': fileURLToPath(new URL('../../../packages/time/index.js', import.meta.url)),
      '@middleware/ui': fileURLToPath(new URL('../../../packages/ui/index.js', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5175,
    fs: {
      allow: [fileURLToPath(new URL('../../../', import.meta.url))],
    },
    proxy: {
      '/docs/api': {
        target: 'http://localhost:3003',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/docs\/api/, '/api'),
      },
      '/docs/media': {
        target: 'http://localhost:3003',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/docs\/media/, '/media'),
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
