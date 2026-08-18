import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // The data contract lives outside this app on purpose: the dashboard is
      // being replaced, and the contract has to outlive it.
      '@contract': path.resolve(__dirname, '../contract'),
    },
  },
  server: {
    port: 5173,
    // ../contract sits above the Vite root, so serving it has to be allowed.
    fs: { allow: ['..'] },
    proxy: {
      // The dashboard talks to the Node API on 3500. Proxying keeps every
      // request origin-relative, so there is no build-time URL to configure
      // and no CORS preflight in development.
      '/api': { target: 'http://127.0.0.1:3500', changeOrigin: true },
    },
  },
})
