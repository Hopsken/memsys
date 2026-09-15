import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const fragments = sqliteTable("fragments", {
  content: text().notNull(),
  createdAt: integer("created_at").notNull(),
  id: text().primaryKey(),
  updatedAt: integer("updated_at").notNull(),
});
