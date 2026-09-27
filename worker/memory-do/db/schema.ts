import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import type { Json } from "../../../contract/plugin";

// The fragment log: one row per record, never updated. `at` is epoch
// milliseconds and orders a ref's records; a null fragment is forgotten.
export const records = sqliteTable(
  "records",
  {
    at: integer().notNull(),
    fragment: text(),
    ref: text().notNull(),
  },
  (table) => [primaryKey({ columns: [table.ref, table.at] })]
);

// One row per plugin the user has configured; no row means the plugin's defaults.
export const pluginConfig = sqliteTable("plugin_config", {
  config: text({ mode: "json" }).$type<Json>().notNull(),
  enabled: integer({ mode: "boolean" }).notNull(),
  name: text().primaryKey(),
  updatedAt: integer("updated_at").notNull(),
});
