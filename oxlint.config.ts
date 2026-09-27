import { defineConfig } from "oxlint";
import type { OxlintOverride } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import vitest from "ultracite/oxlint/vitest";

// Feature-Sliced Design, top to bottom. A layer imports only the layers below
// it; a slice imports another slice only through its index.ts, and never one on
// its own layer. Shared and App have no slices.
const LAYERS = ["app", "pages", "widgets", "features", "entities", "shared"];
const SLICED = new Set(["pages", "widgets", "features", "entities"]);

const layerRules = LAYERS.map((layer, index): OxlintOverride => {
  const banned = [
    ...LAYERS.slice(0, index),
    ...(SLICED.has(layer) ? [layer] : []),
  ];
  const patterns = [
    {
      message: "Import a slice through its index.ts.",
      regex:
        "^@/(pages|widgets|features|entities)/(.+/)?(ui|api|lib|model)(/|$)",
    },
  ];
  if (banned.length > 0) {
    patterns.push({
      message: `client/${layer} may not import ${banned.join(", ")}.`,
      regex: `^@/(${banned.join("|")})(/|$)`,
    });
  }
  return {
    files: [`client/${layer}/**`],
    rules: { "no-restricted-imports": ["error", { patterns }] },
  };
});

export default defineConfig({
  extends: [core, antiSlop, vitest],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "worker-configuration.d.ts",
    // Vendored from the shadcn registry; `shadcn add --overwrite` regenerates it.
    "client/shared/ui/**",
    "!client/shared/ui/toaster.tsx",
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
    ...layerRules,
  ],
  rules: {
    "sort-keys": ["error", "asc", { allowLineSeparatedGroups: true }],
  },
});
