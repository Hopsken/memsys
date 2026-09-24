import { Hono } from "hono";

import type { AppEnv } from "../auth";
import { pluginUpdate } from "../plugin-host";

// Plugin settings for the web UI, mounted at /api/plugins.
export const plugins = new Hono<AppEnv>()
  .get("/", (c) => c.get("memory").listPlugins())
  .put("/:name", async (c) =>
    c
      .get("memory")
      .updatePlugin(c.req.param("name"), pluginUpdate.parse(await c.req.json()))
  )
  .delete("/:name", (c) => c.get("memory").resetPlugin(c.req.param("name")));
