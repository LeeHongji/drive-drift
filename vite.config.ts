import { defineConfig } from 'vitest/config';

// base './' keeps the build relocatable: it must run from any static host path or as a Claude artifact.
export default defineConfig({
  base: './',
  server: { port: 5183, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  test: { include: ['tests/**/*.test.ts'], exclude: ['**/._*', 'node_modules/**'], environment: 'node' },
});
