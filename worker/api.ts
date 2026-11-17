import { Hono } from "hono";

import { apiKeys } from "./routes/api-keys";
import { connections } from "./routes/connections";
import { diagnostics } from "./routes/diagnostics";
import { memory } from "./routes/memory";
import { personas } from "./routes/personas";
import { settings } from "./routes/settings";
import { tidy } from "./tidy/routes";
import type { AppEnv } from "./types";

export const api = new Hono<AppEnv>()
  .route("/", memory)
  .route("/api-keys", apiKeys)
  .route("/connections", connections)
  .route("/diagnostics", diagnostics)
  .route("/personas", personas)
  .route("/settings", settings)
  .route("/tidy", tidy);

export type Api = typeof api;
