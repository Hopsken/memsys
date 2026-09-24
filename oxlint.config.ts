import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import vitest from "ultracite/oxlint/vitest";

export default defineConfig({
  extends: [core, antiSlop, vitest],
  ignorePatterns: [...(core.ignorePatterns ?? []), "worker-configuration.d.ts"],
  overrides: [
    {
      // Plugins and the contract meet the worker only through contract/.
      files: ["contract/**", "plugins/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/worker/**", "**/client/**", "cloudflare:*"],
                message: "Plugins may import only contract/ and packages.",
              },
            ],
          },
        ],
      },
    },
  ],
  rules: {
    "sort-keys": ["error", "asc", { allowLineSeparatedGroups: true }],
  },
});
