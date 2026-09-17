import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// Append-only content and archive history.
export const revisions = sqliteTable(
  "revisions",
  {
    archived: integer({ mode: "boolean" }).notNull().default(false),
    content: text().notNull(),
    createdAt: integer("created_at").notNull(),
    ref: text().notNull(),
    version: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.ref, table.version] })]
);

// Latest revision plus the fragment's original creation time.
export const fragments = sqliteTable("fragments", {
  archived: integer({ mode: "boolean" }).notNull().default(false),
  content: text().notNull(),
  createdAt: integer("created_at").notNull(),
  ref: text().notNull().primaryKey(),
  updatedAt: integer("updated_at").notNull(),
  version: integer().notNull(),
});
