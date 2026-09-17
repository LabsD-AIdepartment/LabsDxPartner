import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  cacheDir: '.agent-work/runtime/cache/vite-performance',
  test: {
    include: ['tests/performance/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    restoreMocks: true,
    testTimeout: 180000,
  },
});
