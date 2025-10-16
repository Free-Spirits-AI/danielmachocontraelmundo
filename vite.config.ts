import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // IMPORTANT: base must match the repo name so assets resolve under /danielmachocontraelmundo/
  base: '/danielmachocontraelmundo/',
})
