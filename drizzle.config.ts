import { defineConfig } from "drizzle-kit";

// The Worker's D1 database, applied by `wrangler d1 migrations`. The memory
// object keeps its own schema in worker/memory-do/.
export default defineConfig({
  dialect: "sqlite",
  out: "./migrations",
  schema: "./worker/db/schema",
});
