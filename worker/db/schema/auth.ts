import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Better Auth's tables in the Worker's D1 database. Better Auth reads them
// directly, so table and column names are its own model and field names, as
// its CLI would generate them. Other D1 tables get their own file here.
const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
const createdAt = () =>
  integer({ mode: "timestamp_ms" }).default(now).notNull();
const updatedAt = () =>
  integer({ mode: "timestamp_ms" }).default(now).notNull();

export const user = sqliteTable("user", {
  createdAt: createdAt(),
  email: text().notNull().unique(),
  emailVerified: integer({ mode: "boolean" }).default(false).notNull(),
  id: text().primaryKey(),
  image: text(),
  name: text().notNull(),
  updatedAt: updatedAt(),
});

export const session = sqliteTable(
  "session",
  {
    createdAt: createdAt(),
    expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
    id: text().primaryKey(),
    ipAddress: text(),
    token: text().notNull().unique(),
    updatedAt: updatedAt(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
);

export const account = sqliteTable(
  "account",
  {
    accessToken: text(),
    accessTokenExpiresAt: integer({ mode: "timestamp_ms" }),
    accountId: text().notNull(),
    createdAt: createdAt(),
    id: text().primaryKey(),
    idToken: text(),
    password: text(),
    providerId: text().notNull(),
    refreshToken: text(),
    refreshTokenExpiresAt: integer({ mode: "timestamp_ms" }),
    scope: text(),
    updatedAt: updatedAt(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("account_userId_idx").on(table.userId)]
);

export const verification = sqliteTable(
  "verification",
  {
    createdAt: createdAt(),
    expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
    id: text().primaryKey(),
    identifier: text().notNull(),
    updatedAt: updatedAt(),
    value: text().notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

// MCP tokens. Only the hash of each key is stored.
export const apikey = sqliteTable(
  "apikey",
  {
    configId: text().default("default").notNull(),
    createdAt: createdAt(),
    enabled: integer({ mode: "boolean" }).default(true),
    expiresAt: integer({ mode: "timestamp_ms" }),
    id: text().primaryKey(),
    key: text().notNull(),
    lastRefillAt: integer({ mode: "timestamp_ms" }),
    lastRequest: integer({ mode: "timestamp_ms" }),
    metadata: text(),
    name: text(),
    permissions: text(),
    prefix: text(),
    rateLimitEnabled: integer({ mode: "boolean" }).default(true),
    rateLimitMax: integer(),
    rateLimitTimeWindow: integer(),
    referenceId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    refillAmount: integer(),
    refillInterval: integer(),
    remaining: integer(),
    requestCount: integer().default(0),
    start: text(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("apikey_key_idx").on(table.key),
    index("apikey_referenceId_idx").on(table.referenceId),
  ]
);

// Rate-limit counters; in-memory counters would reset per isolate.
export const rateLimit = sqliteTable("rateLimit", {
  count: integer().notNull(),
  id: text().primaryKey(),
  key: text().notNull().unique(),
  lastRequest: integer().notNull(),
});
