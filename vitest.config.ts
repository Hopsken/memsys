import { readdir } from "node:fs/promises";
import path from "node:path";

import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  // Drizzle writes one folder per D1 migration; name each the way Wrangler does.
  const migrationsPath = path.join(import.meta.dirname, "migrations");
  const entries = await readdir(migrationsPath, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  const migrations = await Promise.all(
    directories.map(async (directory) => {
      const [migration] = await readD1Migrations(
        path.join(migrationsPath, directory)
      );
      if (!migration) {
        throw new Error(`Missing migration SQL in ${directory}`);
      }
      return { ...migration, name: `${directory}/migration.sql` };
    })
  );

  return {
    plugins: [
      cloudflareTest({
        // Keep auth tests independent of local .dev.vars overrides.
        miniflare: {
          bindings: {
            AUTH_ALLOWED_EMAILS: "@memsys.test",
            BETTER_AUTH_SECRET: "test-secret-with-enough-entropy-0123456789",
            EMAIL_FROM: "memsys <memsys@memsys.test>",
            PUBLIC_URL: "https://memsys.test",
            RESEND_API_KEY: "test-resend-key",
            TEST_MIGRATIONS: migrations,
          },
        },
        // Tests never reach Workers AI; plugins get a fake `ai`. Without this, the
        // AI binding opens a remote session that needs Cloudflare credentials.
        remoteBindings: false,
        wrangler: { configPath: "./wrangler.jsonc" },
      }),
    ],
    test: { setupFiles: ["./tests/apply-migrations.ts"] },
  };
});
