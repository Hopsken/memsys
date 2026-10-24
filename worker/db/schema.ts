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

// API keys for /mcp. Only the hash of each key is stored.
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

// Signing keys for OAuth access tokens.
export const jwks = sqliteTable("jwks", {
  alg: text(),
  createdAt: createdAt(),
  crv: text(),
  expiresAt: integer({ mode: "timestamp_ms" }),
  id: text().primaryKey(),
  privateKey: text().notNull(),
  publicKey: text().notNull(),
});

// OAuth for /mcp: apps that sign in on a user's behalf. List columns hold
// JSON arrays; `metadata` holds a JSON object.
export const oauthClient = sqliteTable(
  "oauthClient",
  {
    applicationType: text(),
    backchannelLogoutSessionRequired: integer({ mode: "boolean" }),
    backchannelLogoutUri: text(),
    clientCredentialsScopes: text(),
    clientDiscoveryId: text(),
    clientId: text().notNull().unique(),
    clientSecret: text(),
    contacts: text(),
    createdAt: createdAt(),
    disabled: integer({ mode: "boolean" }).default(false),
    dpopBoundAccessTokens: integer({ mode: "boolean" }).default(false),
    enableEndSession: integer({ mode: "boolean" }),
    grantTypes: text(),
    icon: text(),
    id: text().primaryKey(),
    jwks: text(),
    jwksUri: text(),
    metadata: text(),
    name: text(),
    policy: text(),
    postLogoutRedirectUris: text(),
    redirectUris: text().notNull(),
    referenceId: text(),
    requirePKCE: integer({ mode: "boolean" }),
    responseTypes: text(),
    scopes: text(),
    skipConsent: integer({ mode: "boolean" }),
    softwareId: text(),
    softwareStatement: text(),
    softwareVersion: text(),
    subjectType: text(),
    tokenEndpointAuthMethod: text(),
    tos: text(),
    updatedAt: updatedAt(),
    uri: text(),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("oauthClient_userId_idx").on(table.userId)]
);

// Resources tokens are issued for; here only /mcp.
export const oauthResource = sqliteTable("oauthResource", {
  accessTokenTtl: integer(),
  allowedScopes: text(),
  createdAt: createdAt(),
  customClaims: text(),
  disabled: integer({ mode: "boolean" }).default(false),
  dpopBoundAccessTokensRequired: integer({ mode: "boolean" }).default(false),
  id: text().primaryKey(),
  identifier: text().notNull().unique(),
  metadata: text(),
  name: text().notNull(),
  policyVersion: integer().default(1),
  refreshTokenTtl: integer(),
  signingAlgorithm: text(),
  signingKeyId: text(),
  updatedAt: updatedAt(),
});

export const oauthClientResource = sqliteTable(
  "oauthClientResource",
  {
    clientId: text()
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    createdAt: createdAt(),
    id: text().primaryKey(),
    metadata: text(),
    resourceId: text()
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
  },
  (table) => [
    index("oauthClientResource_clientId_idx").on(table.clientId),
    index("oauthClientResource_resourceId_idx").on(table.resourceId),
  ]
);

export const oauthRefreshToken = sqliteTable(
  "oauthRefreshToken",
  {
    authTime: integer({ mode: "timestamp_ms" }),
    authorizationCodeId: text(),
    clientId: text()
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    confirmation: text(),
    createdAt: createdAt(),
    expiresAt: integer({ mode: "timestamp_ms" }),
    id: text().primaryKey(),
    referenceId: text(),
    requestedUserInfoClaims: text(),
    resources: text(),
    revoked: integer({ mode: "timestamp_ms" }),
    rotatedAt: integer({ mode: "timestamp_ms" }),
    rotationReplayExpiresAt: integer({ mode: "timestamp_ms" }),
    rotationReplayResponse: text(),
    scopes: text().notNull(),
    sessionId: text().references(() => session.id, { onDelete: "set null" }),
    token: text().notNull().unique(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("oauthRefreshToken_authorizationCodeId_idx").on(
      table.authorizationCodeId
    ),
    index("oauthRefreshToken_clientId_idx").on(table.clientId),
    index("oauthRefreshToken_sessionId_idx").on(table.sessionId),
    index("oauthRefreshToken_userId_idx").on(table.userId),
  ]
);

export const oauthAccessToken = sqliteTable(
  "oauthAccessToken",
  {
    authorizationCodeId: text(),
    clientId: text()
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    confirmation: text(),
    createdAt: createdAt(),
    expiresAt: integer({ mode: "timestamp_ms" }),
    id: text().primaryKey(),
    referenceId: text(),
    refreshId: text().references(() => oauthRefreshToken.id, {
      onDelete: "cascade",
    }),
    requestedUserInfoClaims: text(),
    resources: text(),
    revoked: integer({ mode: "timestamp_ms" }),
    scopes: text().notNull(),
    sessionId: text().references(() => session.id, { onDelete: "set null" }),
    token: text().unique(),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("oauthAccessToken_authorizationCodeId_idx").on(
      table.authorizationCodeId
    ),
    index("oauthAccessToken_clientId_idx").on(table.clientId),
    index("oauthAccessToken_refreshId_idx").on(table.refreshId),
    index("oauthAccessToken_sessionId_idx").on(table.sessionId),
    index("oauthAccessToken_userId_idx").on(table.userId),
  ]
);

// What each user let each app do. Removing one disconnects the app.
export const oauthConsent = sqliteTable(
  "oauthConsent",
  {
    clientId: text()
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    createdAt: createdAt(),
    id: text().primaryKey(),
    referenceId: text(),
    requestedUserInfoClaims: text(),
    resources: text(),
    scopes: text().notNull(),
    updatedAt: updatedAt(),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("oauthConsent_clientId_idx").on(table.clientId),
    index("oauthConsent_userId_idx").on(table.userId),
  ]
);

// Client assertion ids already used, so none is replayed.
export const oauthClientAssertion = sqliteTable("oauthClientAssertion", {
  expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
  id: text().primaryKey(),
});
