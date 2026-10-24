import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["*.eval.ts"],
    root: import.meta.dirname,
    testTimeout: 900_000,
  },
});
