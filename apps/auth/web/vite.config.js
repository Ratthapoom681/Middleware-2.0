import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: '/login/',
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
      '/api': { target: 'http://localhost:3004', changeOrigin: true },
    },
  },
});
