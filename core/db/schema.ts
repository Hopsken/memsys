import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import type { Author, Op } from "../model";
import type { Metadata } from "../types";

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
    index("records_at_ref_idx").on(table.at, table.ref),
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
