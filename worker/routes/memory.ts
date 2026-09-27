import { Hono } from "hono";

import type { ImportFormat } from "../../contract/memory";
import type { AppEnv } from "../auth";
import { inputs, listInput, restoreInput } from "../memory";

// The file's media type picks how it is read; the content is never sniffed.
const IMPORT_FORMATS = new Map<string, ImportFormat>([
  ["application/x-ndjson", "ndjson"],
  ["text/plain", "text"],
]);

// The four memory operations plus paging, migration, history, and purge,
// mounted at /api.
export const memory = new Hono<AppEnv>()
  .get("/fragments", async (c) => {
    c.header("Cache-Control", "no-store");
    // Hono's query object has a null prototype; RPC requires a plain object.
    // `tag` may repeat, so it is read as a list.
    const query = { ...c.req.query(), tag: c.req.queries("tag") };
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
    return result
      ? c.json(result)
      : c.json({ error: "Fragment not found" }, 404);
  })
  .get("/fragments/forgotten", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await c.get("memory").listForgotten());
  })
  .post("/fragments/:ref/restore", async (c) => {
    const { ref } = inputs.forget.parse({ ref: c.req.param("ref") });
    const { at } = restoreInput.parse(await c.req.json());
    const result = await c.get("memory").restore({ at, ref });
    return result
      ? c.json(result)
      : c.json({ error: "Version not found" }, 404);
  })
  .post("/remember", async (c) => {
    const result = await c
      .get("memory")
      .remember(inputs.remember.parse(await c.req.json()));
    return "error" in result ? c.json(result, 422) : c.json(result, 201);
  })
  .post("/recall", async (c) => {
    const result = await c
      .get("memory")
      .recall(inputs.recall.parse(await c.req.json()));
    return "error" in result ? c.json(result, 422) : c.json(result);
  })
  .post("/revise", async (c) => {
    const result = await c
      .get("memory")
      .revise(inputs.revise.parse(await c.req.json()));
    if (!result) {
      return c.json({ error: "Fragment not found" }, 404);
    }
    return "error" in result ? c.json(result, 422) : c.json(result);
  })
  .get("/export", async (c) => {
    // Current fragments by default; `history=true` exports the whole log.
    const history = c.req.query("history") === "true";
    const file = await c.get("memory").exportLog(history);
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
    // Decoded directly: workerd warns when .text() reads a non-text type.
    const content = new TextDecoder().decode(await c.req.arrayBuffer());
    const result = await c.get("memory").importFragments({ content, format });
    return "error" in result ? c.json(result, 422) : c.json(result);
  })
  .post("/purge", async (c) => {
    const result = await c
      .get("memory")
      .purge(inputs.forget.parse(await c.req.json()));
    return result
      ? c.json(result)
      : c.json({ error: "Fragment not found" }, 404);
  })
  .post("/forget", async (c) => {
    const result = await c
      .get("memory")
      .forget(inputs.forget.parse(await c.req.json()));
    return result
      ? c.json(result)
      : c.json({ error: "Fragment not found" }, 404);
  });
