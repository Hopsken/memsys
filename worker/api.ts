import { Hono } from "hono";

import { connections } from "./routes/connections";
import { diagnostics } from "./routes/diagnostics";
import { memory } from "./routes/memory";
import { personas } from "./routes/personas";
import { settings } from "./routes/settings";
import type { AppEnv } from "./types";

export const api = new Hono<AppEnv>()
  .route("/", memory)
  .route("/connections", connections)
  .route("/diagnostics", diagnostics)
  .route("/personas", personas)
  .route("/settings", settings);

export type Api = typeof api;
