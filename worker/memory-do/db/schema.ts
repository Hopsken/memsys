import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import type { Author, Op } from "../../../contract/memory";
import type { Json } from "../../../contract/plugin";

// The fragment log: one row per record, never updated. `at` is epoch
// milliseconds and orders a ref's records; a null fragment is forgotten.
// `op` is the action that wrote the record and `by` who took it; `by` is
// null for records written before it was kept.
export const records = sqliteTable(
  "records",
  {
    at: integer().notNull(),
    by: text().$type<Author>(),
    fragment: text(),
    op: text().$type<Op>().notNull(),
    ref: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ref, table.at] }),
    // Activity reads the log across refs, newest first.
    index("records_at_ref_idx").on(table.at, table.ref),
  ]
);

// One row per plugin the user has configured; no row means the plugin's defaults.
export const pluginConfig = sqliteTable("plugin_config", {
  config: text({ mode: "json" }).$type<Json>().notNull(),
  enabled: integer({ mode: "boolean" }).notNull(),
  name: text().primaryKey(),
  updatedAt: integer("updated_at").notNull(),
});
