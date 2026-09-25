import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Apply the D1 schema before the Worker tests start.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
