import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";

import type { MemoryDO } from "./memory-do";

export interface AppEnv {
  Bindings: Env;
  Variables: { memory: DurableObjectStub<MemoryDO> };
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export const access = createMiddleware<AppEnv>(async (c, next) => {
  const issuer = c.env.ACCESS_ISSUER;
  const audience = c.env.ACCESS_AUD;
  if (!issuer || !audience) {
    return c.json({ error: "Cloudflare Access is not configured" }, 503);
  }
  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (!token) {
    return c.json({ error: "Authentication required" }, 401);
  }
  let subject: string;
  try {
    let keys = keySets.get(issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
      keySets.set(issuer, keys);
    }
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ["RS256"],
      audience,
      issuer,
      requiredClaims: ["sub", "exp", "iat"],
    });
    if (!payload.sub || payload.type !== "app") {
      return c.json({ error: "Invalid Access identity" }, 401);
    }
    subject = payload.sub;
  } catch {
    return c.json({ error: "Invalid Access token" }, 401);
  }
  // Use only verified identity, never client-supplied space names or email headers.
  c.set("memory", c.env.MEMORY.getByName(JSON.stringify([issuer, subject])));
  return next();
});
