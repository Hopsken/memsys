import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

export default { fetch: app.fetch };

export { MemoryDO } from "./memory-do";
