import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { Json } from "../../contract/plugin";

export const fragments = sqliteTable("fragments", {
  content: text().notNull(),
  createdAt: integer("created_at").notNull(),
  id: text().primaryKey(),
  updatedAt: integer("updated_at").notNull(),
});

// One row per plugin the user has configured; no row means the plugin's defaults.
export const pluginConfig = sqliteTable("plugin_config", {
  config: text({ mode: "json" }).$type<Json>().notNull(),
  enabled: integer({ mode: "boolean" }).notNull(),
  name: text().primaryKey(),
  updatedAt: integer("updated_at").notNull(),
});
