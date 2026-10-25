import type { Author } from "@core";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import {
  ALL_SCOPES,
  OAUTH_SCOPES,
  getAuth,
  resourceMetadataUrl,
  verifyAccessToken,
} from "../lib/better-auth";
import {
  apiKeyConnection,
  oauthConnection,
  personaOf,
} from "../lib/connection-personas";
import type { ConnectionKey } from "../lib/connection-personas";
import type { AppEnv } from "../types";

const pointToOAuthSignIn = (c: Context<AppEnv>) => {
  c.header(
    "WWW-Authenticate",
    `Bearer resource_metadata="${resourceMetadataUrl(c.env)}", scope="${OAUTH_SCOPES.join(" ")}"`
  );
  return c.json({ error: "Authentication required" }, 401);
};

const authorOf = async (
  c: Context<AppEnv>,
  userId: string,
  connection: ConnectionKey,
  name: string | null | undefined
): Promise<Author> => {
  const personaId = await personaOf(c.env.DB, userId, connection);
  return personaId === null ? `agent:${name ?? ""}` : `persona:${personaId}`;
};

export const requireToken = createMiddleware<AppEnv>(async (c, next) => {
  const key = /^Bearer\s+(?<key>\S+)$/iu.exec(
    c.req.header("Authorization") ?? ""
  )?.groups?.["key"];
  if (!key) {
    return pointToOAuthSignIn(c);
  }
  if (key.startsWith("memsys_")) {
    const verified = await getAuth(c.env).api.verifyApiKey({ body: { key } });
    if (!verified.valid || !verified.key) {
      return pointToOAuthSignIn(c);
    }
    const userId = verified.key.referenceId;
    c.set(
      "author",
      await authorOf(
        c,
        userId,
        apiKeyConnection(verified.key.id),
        verified.key.name
      )
    );
    c.set("scopes", ALL_SCOPES);
    c.set("userId", userId);
    return next();
  }
  const verified = await verifyAccessToken(c.env, key);
  if (!verified) {
    return pointToOAuthSignIn(c);
  }
  if (verified.scopes.size === 0) {
    c.header(
      "WWW-Authenticate",
      `Bearer error="insufficient_scope", scope="${[...ALL_SCOPES].join(" ")}", resource_metadata="${resourceMetadataUrl(c.env)}"`
    );
    return c.json({ error: "Insufficient scope" }, 403);
  }
  c.set(
    "author",
    await authorOf(
      c,
      verified.userId,
      oauthConnection(verified.clientId),
      verified.name
    )
  );
  c.set("scopes", verified.scopes);
  c.set("userId", verified.userId);
  return next();
});
