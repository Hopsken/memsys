import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    "**/migrations/*/snapshot.json",
    "worker-configuration.d.ts",
    "eval/results.md",
    "eval/longmemeval/hub/**",
  ],
  sortImports: {
    ignoreCase: true,
    internalPattern: ["@/", "@contract/", "@lib/", "@worker/"],
    newlinesBetween: true,
    order: "asc",
  },
});
