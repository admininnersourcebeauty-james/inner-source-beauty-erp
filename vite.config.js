import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ['**/shopify-theme/**'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
