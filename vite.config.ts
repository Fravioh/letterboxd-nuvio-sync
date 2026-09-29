import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'], testTimeout: 20000 },
});
