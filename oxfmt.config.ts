import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    "**/migrations/*/snapshot.json",
    "worker-configuration.d.ts",
  ],
  sortImports: {
    ignoreCase: true,
    internalPattern: ["@/", "@lib/", "@worker/"],
    newlinesBetween: true,
    order: "asc",
  },
});
