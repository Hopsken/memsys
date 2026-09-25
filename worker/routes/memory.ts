import { Hono } from "hono";

import type { AppEnv } from "../auth";
import { inputs, listInput } from "../memory";

// The four memory operations plus paging and migration, mounted at /api.
export const memory = new Hono<AppEnv>()
  .get("/fragments", async (c) => {
    c.header("Cache-Control", "no-store");
    const query = c.req.query();
    if (!listInput.safeParse(query).success) {
      return c.json({ error: "Invalid list query" }, 400);
    }
    // Hono's query object has a null prototype; RPC requires a plain object.
    return c.json(await c.get("memory").list({ ...query }));
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
    const file = await c.get("memory").exportFragments();
    // Indented so a person can read and edit the file.
    return c.body(`${JSON.stringify(file, null, 2)}\n`, 200, {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="memsys-${file.exportedAt.slice(0, 10)}.json"`,
      "Content-Type": "application/json; charset=utf-8",
    });
  })
  .post("/import", async (c) => {
    const result = await c.get("memory").importFragments(await c.req.json());
    return "error" in result ? c.json(result, 422) : c.json(result);
  })
  .post("/forget", async (c) => {
    const result = await c
      .get("memory")
      .forget(inputs.forget.parse(await c.req.json()));
    return result
      ? c.json(result)
      : c.json({ error: "Fragment not found" }, 404);
  });
