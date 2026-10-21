import { defineConfig } from "vitest/config";

// Offline replay against a saved run. Runs in Node, like eval/, and only when
// named: Jev bills Workers AI.
export default defineConfig({
  test: {
    include: ["replay.eval.ts"],
    root: import.meta.dirname,
    testTimeout: 1_800_000,
  },
});
