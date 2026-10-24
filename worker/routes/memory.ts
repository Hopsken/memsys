import { activityInput, inputs, listInput, restoreInput } from "@core";
import { Hono } from "hono";

import type { ImportFormat } from "@contract/memory";

import { recallInput } from "../services/recall";
import type { AppEnv } from "../types";
import { unwrap } from "./problem";

const IMPORT_FORMATS = new Map<string, ImportFormat>([
  ["application/x-ndjson", "ndjson"],
  ["text/plain", "text"],
]);

const toRpcObject = <T extends object>(nullPrototype: T): T => ({
  ...nullPrototype,
});

const textOfAnyMediaType = async (request: Request) =>
  new TextDecoder().decode(await request.arrayBuffer());

export const memory = new Hono<AppEnv>()
  .get("/activity", async (c) => {
    c.header("Cache-Control", "no-store");
    const query = c.req.query();
    if (!activityInput.safeParse(query).success) {
      return c.json({ error: "Invalid activity query" }, 400);
    }
    return c.json(await c.get("memory").activity(toRpcObject(query)));
  })
  .get("/fragments", async (c) => {
    c.header("Cache-Control", "no-store");
    const query = toRpcObject({
      ...c.req.query(),
      tag: c.req.queries("tag"),
    });
    if (!listInput.safeParse(query).success) {
      return c.json({ error: "Invalid list query" }, 400);
    }
    return c.json(await c.get("memory").list(query));
  })
  .get("/fragments/:ref/history", async (c) => {
    c.header("Cache-Control", "no-store");
    const result = await c
      .get("memory")
      .history(inputs.forget.parse({ ref: c.req.param("ref") }));
    return c.json(unwrap(result));
  })
  .get("/fragments/forgotten", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await c.get("memory").forgotten());
  })
  .post("/fragments/:ref/restore", async (c) => {
    const { ref } = inputs.forget.parse({ ref: c.req.param("ref") });
    const { at } = restoreInput.parse(await c.req.json());
    const result = await c.get("memory").restore({ at, ref });
    return c.json(unwrap(result));
  })
  .post("/remember", async (c) => {
    const result = await c
      .get("memory")
      .remember(inputs.remember.parse(await c.req.json()));
    return c.json(unwrap(result), 201);
  })
  .post("/recall", async (c) => {
    const result = await c
      .get("memory")
      .recall(recallInput.parse(await c.req.json()));
    return c.json(unwrap(result));
  })
  .post("/revise", async (c) => {
    const result = await c
      .get("memory")
      .revise(inputs.revise.parse(await c.req.json()));
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
  .post("/purge", async (c) => {
    const result = await c
      .get("memory")
      .purge(inputs.forget.parse(await c.req.json()));
    return c.json(unwrap(result));
  })
  .post("/forget", async (c) => {
    const result = await c
      .get("memory")
      .forget(inputs.forget.parse(await c.req.json()));
    return c.json(unwrap(result));
  });
