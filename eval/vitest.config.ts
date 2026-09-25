import { defineConfig } from "vitest/config";

// Runs in Node, not the Workers pool: the report is written to disk and Jev
// runs through a remote Workers AI binding from wrangler's platform proxy.
export default defineConfig({
  test: {
    include: ["*.eval.ts"],
    root: import.meta.dirname,
    testTimeout: 900_000,
  },
});
