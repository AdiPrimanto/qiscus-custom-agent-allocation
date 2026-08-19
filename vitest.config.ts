import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    hookTimeout: 20000,
    testTimeout: 20000,
    // Test files share a single real Postgres test database, and several test files
    // (e.g. tests/db.prisma.test.ts) do unscoped Assignment/Agent deleteMany() cleanup
    // in afterEach/afterAll. Vitest runs test files in parallel by default, so one
    // file's cleanup can wipe rows another file's in-flight test still depends on
    // (observed as a Prisma P2025 "record not found for update" race). Run test files
    // sequentially to avoid that cross-file DB race.
    fileParallelism: false,
  },
});
