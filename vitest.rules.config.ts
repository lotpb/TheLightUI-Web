import { defineConfig } from 'vitest/config'

// Rules tests are separate from the unit suite because they need the Firestore
// emulator running. Use `npm run test:rules`, which starts it for you.
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // One emulator instance shared by all files; serial execution keeps the
    // per-test clearFirestore() from racing across workers.
    fileParallelism: false,
  },
})
