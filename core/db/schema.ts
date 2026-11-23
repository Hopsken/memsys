import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { Op, Source } from "../model";
import type { Metadata } from "../types";

export const records = sqliteTable(
  "records",
  {
    createdAt: integer()
      .notNull()
      .default(sql`(cast(round(unixepoch('subsecond') * 1000) as integer))`),
    fragment: text(),
    id: integer().primaryKey({ autoIncrement: true }),
    op: text().$type<Op>().notNull(),
    ref: text().notNull(),
    source: text().$type<Source>(),
  },
  (table) => [
    index("records_created_at_id_idx").on(table.createdAt, table.id),
    index("records_ref_id_idx").on(table.ref, table.id),
  ]
);

export const metadata = sqliteTable("metadata", {
  key: text().primaryKey(),
  value: text({ mode: "json" }).$type<Metadata>().notNull(),
});

export const personas = sqliteTable("personas", {
  archivedAt: integer(),
  createdAt: integer().notNull(),
  id: text().primaryKey(),
  name: text().notNull(),
});
