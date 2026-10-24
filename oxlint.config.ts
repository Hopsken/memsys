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

// The memory core and the Worker built on it (RFC 0004). Apps reach the core
// only through core/index.ts, and the Durable Object class through core/do.ts:
// `@core` and `@core/do`. Each rule lists relative paths and their aliases.
const coreInternals = {
  group: ["**/core/*", "@core/*", "!**/core/do", "!**/core/index", "!@core/do"],
  message:
    "Import the core through core/index.ts (or core/do.ts for the Durable Object class).",
};
const restrict = (
  files: string[],
  patterns: { group: string[]; message: string }[]
): OxlintOverride => ({
  files,
  rules: { "no-restricted-imports": ["error", { patterns }] },
});

// Worker: routes → services → clients and lib. Services hold the rules and
// stay free of HTTP and platform APIs, so tests run them in Node. A later
// override replaces an earlier one's patterns, so each repeats coreInternals.
const workerRules = [
  restrict(["worker/**"], [coreInternals]),
  restrict(
    ["worker/services/**"],
    [
      coreInternals,
      {
        group: [
          "hono",
          "hono/*",
          "cloudflare:*",
          "better-auth*",
          "@better-auth/*",
          "@modelcontextprotocol/*",
          "**/routes/**",
          "**/middlewares/**",
          "**/clients/**",
          // The Worker's own lib/, not the shared root lib/.
          "../lib/*",
        ],
        message:
          "worker/services may import only the core, contract/, lib/, and worker/errors.",
      },
    ]
  ),
  restrict(
    ["worker/clients/**", "worker/lib/**", "worker/middlewares/**"],
    [
      coreInternals,
      {
        group: ["**/routes/**", "**/services/**"],
        message:
          "Only routes call services; clients, lib, and middlewares sit below them.",
      },
    ]
  ),
  restrict(
    ["core/**"],
    [
      {
        group: ["**/worker/**", "**/client/**", "@/**"],
        message: "core/ may import only contract/, lib/, and packages.",
      },
    ]
  ),
];

export default defineConfig({
  extends: [core, antiSlop, vitest],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "worker-configuration.d.ts",
    // Vendored from the shadcn registry; `shadcn add --overwrite` regenerates it.
    "client/shared/ui/**",
    "!client/shared/ui/logo.tsx",
    "!client/shared/ui/toaster.tsx",
  ],
  overrides: [
    {
      // Shared code meets the worker and client only through contract/ and lib/.
      files: ["contract/**", "lib/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "**/worker/**",
                  "**/client/**",
                  "**/core/**",
                  "**/core",
                  "@core",
                  "@core/**",
                  "@/**",
                  "cloudflare:*",
                ],
                message:
                  "contract/ and lib/ may import only contract/, lib/, and packages.",
              },
            ],
          },
        ],
      },
    },
    ...layerRules,
    ...workerRules,
  ],
  rules: {
    "sort-keys": ["error", "asc", { allowLineSeparatedGroups: true }],
  },
});
