import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 10000,
  },
});
