import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import type { Author } from "@contract/memory";

import {
  ALL_SCOPES,
  OAUTH_SCOPES,
  getAuth,
  resourceMetadataUrl,
  verifyAccessToken,
} from "../lib/better-auth";
import { defaultSpace, memoryOf } from "../lib/memory";
import type { AppEnv } from "../types";

// Points apps without a token to OAuth sign-in (RFC 9728).
const unauthorized = (c: Context<AppEnv>) => {
  c.header(
    "WWW-Authenticate",
    `Bearer resource_metadata="${resourceMetadataUrl(c.env)}", scope="${OAUTH_SCOPES.join(" ")}"`
  );
  return c.json({ error: "Authentication required" }, 401);
};

// An app names itself when it registers, so its name is only ever shown as
// an agent's and cannot pass for the user.
const agent = (name: string | null | undefined): Author =>
  `agent:${name ?? ""}`;

// /mcp: an API key or an OAuth access token as a bearer token,
// naming the user who created it.
export const requireToken = createMiddleware<AppEnv>(async (c, next) => {
  const key = /^Bearer\s+(?<key>\S+)$/iu.exec(
    c.req.header("Authorization") ?? ""
  )?.groups?.["key"];
  if (!key) {
    return unauthorized(c);
  }
  if (key.startsWith("memsys_")) {
    const verified = await getAuth(c.env).api.verifyApiKey({ body: { key } });
    if (!verified.valid || !verified.key) {
      return unauthorized(c);
    }
    c.set("by", agent(verified.key.name));
    c.set("memory", memoryOf(defaultSpace(verified.key.referenceId)));
    c.set("scopes", ALL_SCOPES);
    c.set("userId", verified.key.referenceId);
    return next();
  }
  const verified = await verifyAccessToken(c.env, key);
  if (!verified) {
    return unauthorized(c);
  }
  if (verified.scopes.size === 0) {
    c.header(
      "WWW-Authenticate",
      `Bearer error="insufficient_scope", scope="${[...ALL_SCOPES].join(" ")}", resource_metadata="${resourceMetadataUrl(c.env)}"`
    );
    return c.json({ error: "Insufficient scope" }, 403);
  }
  c.set("by", agent(verified.name));
  c.set("memory", memoryOf(defaultSpace(verified.userId)));
  c.set("scopes", verified.scopes);
  c.set("userId", verified.userId);
  return next();
});
