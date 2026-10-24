import { defineConfig } from "drizzle-kit";

// The Worker's D1 database, applied by `wrangler d1 migrations`. The memory
// core keeps its own schema in core/.
export default defineConfig({
  dialect: "sqlite",
  out: "./migrations",
  schema: "./worker/db/schema",
});
