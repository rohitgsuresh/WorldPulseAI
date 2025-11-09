import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Final production config for WorldPulse
export default defineConfig({
  plugins: [react()],
  server: {
    strictPort: true,
    port: 5173
  },
  preview: {
    strictPort: true,
    port: 8080
  },
  build: {
    rollupOptions: {
      external: ['fsevents']
    }
  }
})
