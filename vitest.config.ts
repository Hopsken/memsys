import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      // Keep auth tests independent of local .dev.vars overrides.
      miniflare: {
        bindings: {
          ACCESS_AUD: "memory-app",
          ACCESS_ISSUER: "https://memsys-test.cloudflareaccess.com",
          DEV_IDENTITY: "",
        },
      },
      // Tests never reach Workers AI; plugins get a fake `ai`. Without this, the
      // AI binding opens a remote session that needs Cloudflare credentials.
      remoteBindings: false,
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
