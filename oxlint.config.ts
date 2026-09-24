import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import vitest from "ultracite/oxlint/vitest";

export default defineConfig({
  extends: [core, antiSlop, vitest],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "worker-configuration.d.ts",
    // Vendored from the shadcn registry; `shadcn add --overwrite` regenerates it.
    "client/components/ui/**",
  ],
  overrides: [
    {
      // Plugins meet the worker only through contract/ and shared lib/.
      files: ["contract/**", "lib/**", "plugins/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/worker/**", "**/client/**", "cloudflare:*"],
                message:
                  "contract/, lib/, and plugins/ may import only contract/, lib/, and packages.",
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
