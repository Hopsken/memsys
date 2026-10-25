import { Hono } from "hono";

import { getAuth } from "../lib/better-auth";
import { assignPersona, oauthConnection } from "../lib/connection-personas";
import type { AppEnv } from "../types";

interface Consent {
  clientId: string;
  createdAt: Date;
  id: string;
  scopes: string[];
}

interface Client {
  clientId: string;
  name?: string | null;
}

export const connections = new Hono<AppEnv>()
  .get("/", async (c) => {
    c.header("Cache-Control", "no-store");
    const { adapter } = await getAuth(c.env).$context;
    const consents = await adapter.findMany<Consent>({
      model: "oauthConsent",
      sortBy: { direction: "desc", field: "createdAt" },
      where: [{ field: "userId", value: c.get("userId") }],
    });
    const clients =
      consents.length === 0
        ? []
        : await adapter.findMany<Client>({
            model: "oauthClient",
            where: [
              {
                field: "clientId",
                operator: "in",
                value: consents.map((consent) => consent.clientId),
              },
            ],
          });
    const byId = new Map(clients.map((client) => [client.clientId, client]));
    return c.json(
      consents.map((consent) => {
        const client = byId.get(consent.clientId);
        return {
          connection: oauthConnection(consent.clientId),
          createdAt: consent.createdAt,
          id: consent.id,
          name: client?.name ?? null,
          scopes: consent.scopes,
        };
      })
    );
  })
  .delete("/:id", async (c) => {
    const { adapter } = await getAuth(c.env).$context;
    const userId = c.get("userId");
    const where = [
      { field: "id", value: c.req.param("id") },
      { field: "userId", value: userId },
    ];
    const consent = await adapter.findOne<Consent>({
      model: "oauthConsent",
      where,
    });
    if (!consent) {
      return c.json({ error: "Connection not found" }, 404);
    }
    await adapter.delete({ model: "oauthConsent", where });
    await assignPersona(
      c.env.DB,
      userId,
      oauthConnection(consent.clientId),
      null
    );
    await adapter.updateMany({
      model: "oauthRefreshToken",
      update: { revoked: new Date() },
      where: [
        { field: "userId", value: userId },
        { field: "clientId", value: consent.clientId },
      ],
    });
    return c.body(null, 204);
  });
