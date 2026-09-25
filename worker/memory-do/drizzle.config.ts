import { defineConfig } from "drizzle-kit";

// The memory Durable Object's own SQLite; migrations are bundled into the
// object and run when it starts. Run from the repo root.
export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  out: "./worker/memory-do/migrations",
  schema: "./worker/memory-do/db/schema.ts",
});
