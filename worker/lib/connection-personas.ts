export type ConnectionKey = `apiKey:${string}` | `oauth:${string}`;

export interface ConnectionPersona {
  connection: ConnectionKey;
  personaId: string;
}

export const oauthConnection = (clientId: string): ConnectionKey =>
  `oauth:${clientId}`;

export const apiKeyConnection = (keyId: string): ConnectionKey =>
  `apiKey:${keyId}`;

export const personaOf = async (
  db: D1Database,
  userId: string,
  connection: ConnectionKey
) =>
  await db
    .prepare(
      'SELECT "personaId" FROM "connectionPersonas" WHERE "userId" = ? AND "connection" = ?'
    )
    .bind(userId, connection)
    .first<string>("personaId");

// A revoked API key leaves its row behind; it matches no request, so only
// rows whose key or consent still exists count.
export const listConnectionPersonas = async (
  db: D1Database,
  userId: string
) => {
  const { results } = await db
    .prepare(
      `SELECT "connection", "personaId" FROM "connectionPersonas" AS "row"
      WHERE "row"."userId" = ?1 AND (
        EXISTS (SELECT 1 FROM "apikey" WHERE "row"."connection" = 'apiKey:' || "apikey"."id" AND "apikey"."referenceId" = ?1)
        OR EXISTS (SELECT 1 FROM "oauthConsent" WHERE "row"."connection" = 'oauth:' || "oauthConsent"."clientId" AND "oauthConsent"."userId" = ?1)
      )`
    )
    .bind(userId)
    .all<ConnectionPersona>();
  return results;
};

export const assignPersona = async (
  db: D1Database,
  userId: string,
  connection: ConnectionKey,
  personaId: string | null
) => {
  await (
    personaId === null
      ? db
          .prepare(
            'DELETE FROM "connectionPersonas" WHERE "userId" = ? AND "connection" = ?'
          )
          .bind(userId, connection)
      : db
          .prepare(
            'INSERT INTO "connectionPersonas" ("userId", "connection", "personaId") VALUES (?, ?, ?) ON CONFLICT ("userId", "connection") DO UPDATE SET "personaId" = excluded."personaId"'
          )
          .bind(userId, connection, personaId)
  ).run();
};

export const unassignAll = async (
  db: D1Database,
  userId: string,
  personaId: string
) => {
  await db
    .prepare(
      'DELETE FROM "connectionPersonas" WHERE "userId" = ? AND "personaId" = ?'
    )
    .bind(userId, personaId)
    .run();
};

export const ownsConnection = async (
  db: D1Database,
  userId: string,
  connection: ConnectionKey
) => {
  const separator = connection.indexOf(":");
  const id = connection.slice(separator + 1);
  const statement = connection.startsWith("apiKey:")
    ? 'SELECT 1 FROM "apikey" WHERE "id" = ? AND "referenceId" = ?'
    : 'SELECT 1 FROM "oauthConsent" WHERE "clientId" = ? AND "userId" = ?';
  return (await db.prepare(statement).bind(id, userId).first()) !== null;
};
