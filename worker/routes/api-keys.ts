import { Hono } from "hono";
import { z } from "zod";

import {
  MEMORY_READ,
  MEMORY_WRITE,
  apiKeyPermissions,
  getAuth,
} from "../lib/better-auth";
import type { Scope } from "../lib/better-auth";
import { validate } from "../lib/validate";
import type { AppEnv } from "../types";

const apiKeyInputSchema = z.object({
  name: z.string().trim().min(1).max(64),
  write: z.boolean(),
});

// better-auth lets only the server set a key's permissions, so the web UI
// creates keys here instead of calling /api/auth/api-key/create.
export const apiKeys = new Hono<AppEnv>().post(
  "/",
  validate("json", apiKeyInputSchema),
  async (c) => {
    const { name, write } = c.req.valid("json");
    const scopes: Scope[] = write ? [MEMORY_READ, MEMORY_WRITE] : [MEMORY_READ];
    const { key } = await getAuth(c.env).api.createApiKey({
      body: {
        name,
        permissions: apiKeyPermissions(scopes),
        userId: c.get("userId"),
      },
    });
    return c.json({ key }, 201);
  }
);
