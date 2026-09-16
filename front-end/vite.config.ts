import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // The data contract lives outside this app on purpose: the dashboard is
      // being replaced, and the contract has to outlive it.
      '@contract': path.resolve(__dirname, '../contract'),
    },
  },
  server: {
    // 5174, NOT 5173, since 2026-08-28. The finalized SvelteKit UI is the clinical demo and takes
    // 5173; this app is now the engineering view -- the simulation bar, the ward stream and the
    // telemetry dock -- and both run against the same Node API. `allowedOrigins.js` already lists
    // this port, so nothing else has to move.
    port: 5174,
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
