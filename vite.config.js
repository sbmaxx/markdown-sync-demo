import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Базовый путь для GitHub Pages: https://sbmaxx.github.io/markdown-sync-demo/
  base: '/markdown-sync-demo/',
});
