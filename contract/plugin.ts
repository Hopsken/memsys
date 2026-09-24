import type { z } from "zod";

import type { Fragment, RecallInput, RecallItem } from "./memory";

// Values that cross the Durable Object RPC and HTTP boundaries.
// Interfaces keep the recursion lazy for RPC type mapping.
export type Json = string | number | boolean | null | JsonArray | JsonObject;
export interface JsonObject {
  [key: string]: Json;
}
export type JsonArray = Json[];

export interface Verdict {
  warnings: string[];
  rejections: string[];
}

export interface Ctx<C> {
  config: C;
  corpus: ReadonlyMap<string, Fragment>;
  index: { anchors: (ref: string) => string[] };
}

export interface ToolDef<C> {
  name: string;
  description: string;
  input: z.ZodObject;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  // `input` has already been parsed by the tool's `input` schema.
  run: (ctx: Ctx<C>, input: z.output<z.ZodObject>) => Promise<Json>;
}

export interface Plugin<C> {
  name: string;
  title: string;
  description: string;
  config: z.ZodType<C>;
  defaults: { enabled: boolean; config: C };
  tools?: ToolDef<C>[];
  // Runs in registry order on the previous hook's output. It may reorder or
  // drop items; anything else it returns is ignored.
  afterRecall?: (
    ctx: Ctx<C>,
    items: readonly RecallItem[],
    input: RecallInput
  ) => Promise<RecallItem[]>;
  beforeRemember?: (ctx: Ctx<C>, text: string) => Promise<Verdict>;
  beforeRevise?: (
    ctx: Ctx<C>,
    prev: Fragment,
    text: string
  ) => Promise<Verdict>;
}

// What the config UI reads for each plugin.
export interface PluginView {
  name: string;
  title: string;
  description: string;
  enabled: boolean;
  config: Json;
  defaults: { enabled: boolean; config: Json };
  schema: JsonObject;
  status: "default" | "custom" | "invalid";
  tools: string[];
  updatedAt: number | null;
}

// Throw to stop the pipeline; any other exception only skips this plugin.
export class PluginAbortError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "PluginAbortError";
    this.reason = reason;
  }
}

// Erases C so plugins with different configs share one registry. Each hook
// re-parses its config, so a plugin always receives a C, never arbitrary JSON.
export const definePlugin = <C extends Json>(
  plugin: Plugin<C>
): Plugin<Json> => {
  const { afterRecall, beforeRemember, beforeRevise, tools, ...rest } = plugin;
  const narrow = (ctx: Ctx<Json>): Ctx<C> => ({
    ...ctx,
    config: plugin.config.parse(ctx.config),
  });
  return {
    ...rest,
    ...(afterRecall && {
      afterRecall: (ctx, items, input) =>
        afterRecall(narrow(ctx), items, input),
    }),
    ...(beforeRemember && {
      beforeRemember: (ctx, text) => beforeRemember(narrow(ctx), text),
    }),
    ...(beforeRevise && {
      beforeRevise: (ctx, prev, text) => beforeRevise(narrow(ctx), prev, text),
    }),
    ...(tools && {
      tools: tools.map((tool) => ({
        ...tool,
        run: (ctx, input) => tool.run(narrow(ctx), input),
      })),
    }),
  };
};
