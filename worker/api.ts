import { Hono } from "hono";

import { connections } from "./routes/connections";
import { memory } from "./routes/memory";
import { settings } from "./routes/settings";
import type { AppEnv } from "./types";

export const api = new Hono<AppEnv>()
  .route("/", memory)
  .route("/connections", connections)
  .route("/settings", settings);

export type Api = typeof api;
