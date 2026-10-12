import { defineConfig } from 'vitest/config';

// base: './' keeps every asset path relative, so the production build works
// from any static host or sub-path (GitHub Pages, Netlify, itch.io, a USB stick...).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
