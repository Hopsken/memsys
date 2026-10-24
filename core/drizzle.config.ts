import { defineConfig } from "drizzle-kit";

// The memory core's own SQLite; migrations are bundled into the
// object and run when it starts. Run from the repo root.
export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  out: "./core/migrations",
  schema: "./core/db/schema.ts",
});
