import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    "**/migrations/*/snapshot.json",
    "worker-configuration.d.ts",
    // Written by `pnpm eval`.
    "eval/results.md",
  ],
  // The client's path aliases sort with its own imports, not with packages.
  sortImports: {
    ignoreCase: true,
    internalPattern: ["@/", "@contract/", "@lib/"],
    newlinesBetween: true,
    order: "asc",
  },
});
