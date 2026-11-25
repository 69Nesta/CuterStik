import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Rust server listens on :8080. Proxying /ws lets the client always
// connect to its own origin, in dev and in production.
const SERVER = process.env.GAME_SERVER ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022' },
  server: {
    host: true,
    proxy: {
      '/ws': { target: SERVER, ws: true },
      '/api': { target: SERVER },
    },
  },
})
