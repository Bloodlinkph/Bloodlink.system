import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// VITE_BASE is set by the GitHub Pages workflow (the site lives at /<repo-name>/).
// Locally it is unset, so `npm run dev` keeps working at http://localhost:5173/.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
})