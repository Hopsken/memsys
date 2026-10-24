import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  out: "./core/migrations",
  schema: "./core/db/schema.ts",
});
