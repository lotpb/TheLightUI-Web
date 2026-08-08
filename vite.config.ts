import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime — loads immediately, cached forever
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // Firebase split by service so only what's used is loaded
          'firebase-core': ['firebase/app', 'firebase/auth'],
          'firebase-db':   ['firebase/firestore', 'firebase/storage', 'firebase/functions'],
          // Recharts is large — only loaded on /chart and /expenses
          'recharts':      ['recharts'],
        },
      },
    },
  },
})
