import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  out: "./migrations",
  schema: "./src/db/schema.ts",
});
