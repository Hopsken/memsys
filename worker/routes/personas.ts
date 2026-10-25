import { personaIdSchema, personaInputSchemas, personaNameSchema } from "@core";
import { Hono } from "hono";
import { z } from "zod";

import {
  assignPersona,
  listConnectionPersonas,
  ownsConnection,
  unassignAll,
} from "../lib/connection-personas";
import { unwrap } from "../lib/problem";
import { validate } from "../lib/validate";
import type { AppEnv } from "../types";

const id = validate("param", z.object({ id: personaIdSchema }));

const assignmentSchema = z.object({
  connection: z.union([
    z.templateLiteral(["apiKey:", z.string().min(1)]),
    z.templateLiteral(["oauth:", z.string().min(1)]),
  ]),
  personaId: personaIdSchema.nullable(),
});

export const personas = new Hono<AppEnv>()
  .get("/", async (c) => {
    c.header("Cache-Control", "no-store");
    const memory = c.get("memory");
    const [list, authors, assigned] = await Promise.all([
      memory.personas(),
      memory.authors(),
      listConnectionPersonas(c.env.DB, c.get("userId")),
    ]);
    const lastChangeAt = new Map(authors.map(({ by, lastAt }) => [by, lastAt]));
    return c.json(
      list.map((persona) => ({
        ...persona,
        connections: assigned.filter(
          ({ personaId }) => personaId === persona.id
        ).length,
        lastChangeAt: lastChangeAt.get(`persona:${persona.id}`) ?? null,
      }))
    );
  })
  .post("/", validate("json", personaInputSchemas.create), async (c) => {
    const result = await c.get("memory").createPersona(c.req.valid("json"));
    return c.json(unwrap(result), 201);
  })
  .patch(
    "/:id",
    id,
    validate("json", z.object({ name: personaNameSchema })),
    async (c) => {
      const result = await c.get("memory").renamePersona({
        id: c.req.valid("param").id,
        name: c.req.valid("json").name,
      });
      return c.json(unwrap(result));
    }
  )
  // Connections are removed first: if archiving then fails, the persona is
  // still active with no connections, and never archived while still written.
  .put(
    "/:id/archived",
    id,
    validate("json", z.object({ archived: z.boolean() })),
    async (c) => {
      const { id: personaId } = c.req.valid("param");
      const { archived } = c.req.valid("json");
      if (archived) {
        await unassignAll(c.env.DB, c.get("userId"), personaId);
      }
      const result = await c
        .get("memory")
        .setPersonaArchived({ archived, id: personaId });
      return c.json(unwrap(result));
    }
  )
  .get("/assignments", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await listConnectionPersonas(c.env.DB, c.get("userId")));
  })
  .put("/assignments", validate("json", assignmentSchema), async (c) => {
    const { connection, personaId } = c.req.valid("json");
    const userId = c.get("userId");
    if (!(await ownsConnection(c.env.DB, userId, connection))) {
      return c.json({ error: "Connection not found" }, 404);
    }
    if (personaId !== null) {
      const list = await c.get("memory").personas();
      const persona = list.find((each) => each.id === personaId);
      if (!persona) {
        return c.json({ error: "Persona not found" }, 404);
      }
      if (persona.archivedAt !== null) {
        return c.json({ error: "Unarchive this agent first." }, 422);
      }
    }
    await assignPersona(c.env.DB, userId, connection, personaId);
    return c.json({ connection, personaId });
  });
