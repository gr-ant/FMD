import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In Docker, /api is proxied to the `api` service (VITE_API_PROXY). Locally it
// defaults to http://localhost:4000 (run the API or rely on the data.json
// fallback baked into useSource).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    open: !process.env.VITE_DISABLE_OPEN,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
