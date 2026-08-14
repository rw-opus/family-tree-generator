import { defineConfig } from "vitest/config";

/**
 * The tenant-isolation suite is deliberately kept out of `npm test`: it needs a
 * running Supabase instance, and a suite that quietly skips when the instance
 * is missing would let a green CI run mean nothing was checked. `npm run
 * test:rls` fails loudly instead.
 */
export default defineConfig({
  test: {
    include: ["tests/security/**/*.test.js"],
    // Users and trees are created and torn down per file; running files in
    // parallel against one database makes failures hard to read.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
