import {
  activityInputSchema,
  inputSchemas,
  listInputSchema,
  restoreInputSchema,
} from "@core";
import type { ImportFormat } from "@core";
import { Hono } from "hono";
import { validator } from "hono/validator";

import { unwrap } from "../lib/problem";
import { validate } from "../lib/validate";
import { recallInputSchema } from "../services/recall";
import type { AppEnv } from "../types";

const IMPORT_FORMATS = new Map<string, ImportFormat>([
  ["application/x-ndjson", "ndjson"],
  ["text/plain", "text"],
]);

const toRpcObject = <T extends object>(nullPrototype: T): T => ({
  ...nullPrototype,
});

const ref = validate("param", inputSchemas.forget);

const textOfAnyMediaType = async (request: Request) =>
  new TextDecoder().decode(await request.arrayBuffer());

export const memory = new Hono<AppEnv>()
  .get(
    "/activity",
    validator("query", (value, c) => {
      const query: { cursor?: string | undefined } = toRpcObject(value);
      if (!activityInputSchema.safeParse(query).success) {
        return c.json({ error: "Invalid activity query" }, 400);
      }
      return query;
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await c.get("memory").activity(c.req.valid("query")));
    }
  )
  .get(
    "/fragments",
    validator("query", (value, c) => {
      const query: { cursor?: string | undefined; tag?: string[] | undefined } =
        toRpcObject({ ...value, tag: c.req.queries("tag") });
      if (!listInputSchema.safeParse(query).success) {
        return c.json({ error: "Invalid list query" }, 400);
      }
      return query;
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await c.get("memory").list(c.req.valid("query")));
    }
  )
  .get("/fragments/:ref/history", ref, async (c) => {
    c.header("Cache-Control", "no-store");
    const result = await c.get("memory").history(c.req.valid("param"));
    return c.json(unwrap(result));
  })
  .get("/fragments/forgotten", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await c.get("memory").forgotten());
  })
  .post(
    "/fragments/:ref/restore",
    ref,
    validate("json", restoreInputSchema),
    async (c) => {
      const result = await c.get("memory").restore({
        at: Date.parse(c.req.valid("json").at),
        ref: c.req.valid("param").ref,
      });
      return c.json(unwrap(result));
    }
  )
  .post("/remember", validate("json", inputSchemas.remember), async (c) => {
    const result = await c.get("memory").remember(c.req.valid("json"));
    return c.json(unwrap(result), 201);
  })
  .post("/recall", validate("json", recallInputSchema), async (c) => {
    const result = await c.get("memory").recall(c.req.valid("json"));
    return c.json(unwrap(result));
  })
  .post("/revise", validate("json", inputSchemas.revise), async (c) => {
    const result = await c.get("memory").revise(c.req.valid("json"));
    return c.json(unwrap(result));
  })
  .get("/export", async (c) => {
    const history = c.req.query("history") === "true";
    const file = await c.get("memory").exportLog({ history });
    const date = new Date().toISOString().slice(0, 10);
    const name = `memsys-${date}${history ? "-history" : ""}.ndjson`;
    return c.body(file, 200, {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Type": "application/x-ndjson; charset=utf-8",
    });
  })
  .post("/import", async (c) => {
    const mediaType = c.req
      .header("Content-Type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    const format = IMPORT_FORMATS.get(mediaType ?? "");
    if (!format) {
      return c.json(
        { error: "Content-Type must be application/x-ndjson or text/plain" },
        415
      );
    }
    const content = await textOfAnyMediaType(c.req.raw);
    const result = await c.get("memory").importLog({ content, format });
    return c.json(unwrap(result));
  })
  .post("/purge", validate("json", inputSchemas.forget), async (c) => {
    const result = await c.get("memory").purge(c.req.valid("json"));
    return c.json(unwrap(result));
  })
  .post("/forget", validate("json", inputSchemas.forget), async (c) => {
    const result = await c.get("memory").forget(c.req.valid("json"));
    return c.json(unwrap(result));
  });
