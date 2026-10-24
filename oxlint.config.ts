import { defineConfig } from "oxlint";
import type { OxlintOverride } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import vitest from "ultracite/oxlint/vitest";

const LAYERS = ["app", "pages", "widgets", "features", "entities", "shared"];
const SLICED = new Set(["pages", "widgets", "features", "entities"]);

const layerRules = LAYERS.map((layer, index): OxlintOverride => {
  const banned = [
    ...LAYERS.slice(0, index),
    ...(SLICED.has(layer) ? [layer] : []),
  ];
  const patterns: ({ allowTypeImports?: boolean; message: string } & (
    | { group: string[] }
    | { regex: string }
  ))[] = [
    // RFC 0004: the web UI reaches the core only through the Worker.
    {
      group: ["@core", "@core/**", "**/core", "**/core/**"],
      message: "client/ may not import the core; call the Worker API.",
    },
    {
      allowTypeImports: true,
      group: ["@worker", "@worker/**", "**/worker", "**/worker/**"],
      message: "client/ may import only types from the Worker.",
    },
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

// A later override replaces an earlier one's patterns, so each repeats
// coreInternals.
const workerRules: OxlintOverride[] = [
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
          "../lib/*",
        ],
        message:
          "worker/services may import only the core, lib/, and worker/errors.",
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
  // Every call to a memory space goes through MemoryService, so none skips
  // the Worker's rules: only lib/memory.ts touches the MEMORY binding.
  {
    files: ["worker/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          message: "Use openMemory() from worker/lib/memory.ts.",
          property: "MEMORY",
        },
      ],
    },
  },
  // Composition: the one file that holds the binding and opens the
  // MemoryService routes receive. Later overrides win.
  restrict(["worker/lib/memory.ts"], [coreInternals]),
  {
    files: ["worker/lib/memory.ts"],
    rules: { "no-restricted-properties": "off" },
  },
  restrict(
    ["core/**"],
    [
      {
        group: ["**/worker/**", "**/client/**", "@/**"],
        message: "core/ may import only lib/ and packages.",
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
      files: ["lib/**"],
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
                  "@worker/**",
                  "cloudflare:*",
                ],
                message: "lib/ may import only lib/ and packages.",
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
