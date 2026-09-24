import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import type { PluginView } from "../contract/plugin";
import worker from "../worker/index";
import { call, post, useAccess } from "./helpers";

const memoryFor = (sub: string) =>
  env.MEMORY.getByName(JSON.stringify([env.ACCESS_ISSUER, sub]));

interface Limits {
  hard: number;
  soft: number;
}

type Result = PluginView & { issues?: { path: string[] }[] };

const views = (response: Response) => response.json<PluginView[]>();

const getPlugins = async (jwt: string) => {
  const response = await worker.fetch(
    new Request("https://memsys.test/api/plugins", {
      headers: { "Cf-Access-Jwt-Assertion": jwt },
    }),
    env
  );
  return views(response);
};

const send = (
  method: string,
  name: string,
  jwt: string,
  body?: string,
  headers: Record<string, string> = {}
) =>
  worker.fetch(
    new Request(`https://memsys.test/api/plugins/${name}`, {
      body: body ?? null,
      headers: {
        "Cf-Access-Jwt-Assertion": jwt,
        "Content-Type": "application/json",
        ...headers,
      },
      method,
    }),
    env
  );

const toolNames = async (jwt: string) => {
  const response = await post(
    "/mcp",
    { id: 1, jsonrpc: "2.0", method: "tools/list" },
    jwt
  );
  const body = await response.json<{ result: { tools: { name: string }[] } }>();
  return body.result.tools.map((tool) => tool.name).toSorted();
};

describe("Plugin configuration", () => {
  const token = useAccess();

  it("lists plugins with defaults and a JSON Schema for each config", async () => {
    const listed = await getPlugins(await token());
    expect(
      listed.map(({ config, name, schema, status, tools }) => ({
        config,
        name,
        properties: Object.keys(schema["properties"] ?? {}),
        status,
        tools,
      }))
    ).toStrictEqual([
      {
        config: { hard: 500, soft: 300 },
        name: "size-limit",
        properties: ["hard", "soft"],
        status: "default",
        tools: [],
      },
      {
        config: {},
        name: "list-tags",
        properties: [],
        status: "default",
        tools: ["list_tags"],
      },
      {
        config: {},
        name: "idf",
        properties: [],
        status: "default",
        tools: [],
      },
      {
        config: { matches: false, threshold: 0.5 },
        name: "jev",
        properties: ["matches", "threshold"],
        status: "default",
        tools: [],
      },
    ]);
  });

  it("validates updates, detects conflicts, persists, and resets", async () => {
    const memory = memoryFor(crypto.randomUUID());
    const update = async (config: Limits, updatedAt: number | null) => {
      const response = await memory.updatePlugin("size-limit", {
        config: { ...config },
        enabled: true,
        updatedAt,
      });
      return { body: await response.json<Result>(), status: response.status };
    };
    const invalid = await update({ hard: 10, soft: 20 }, null);
    const saved = await update({ hard: 20, soft: 10 }, null);
    const stale = await update({ hard: 30, soft: 10 }, null);
    await evictDurableObject(memory);
    const [persisted] = await views(await memory.listPlugins());
    const reset = await memory.resetPlugin("size-limit");
    const missing = await memory.resetPlugin("missing");
    const restored = await reset.json<PluginView>();
    expect({
      invalid,
      missing: missing.status,
      persisted,
      reset: restored.status,
      saved,
      stale: stale.status,
    }).toMatchObject({
      invalid: { body: { issues: [{ path: ["soft"] }] }, status: 422 },
      missing: 404,
      persisted: { config: { hard: 20, soft: 10 }, status: "custom" },
      reset: "default",
      saved: { body: { config: { hard: 20, soft: 10 } }, status: 200 },
      stale: 409,
    });
  });

  it("registers tool plugins only while enabled", async () => {
    const sub = crypto.randomUUID();
    const jwt = await token({ sub });
    const before = await toolNames(jwt);
    await memoryFor(sub).updatePlugin("list-tags", {
      config: {},
      enabled: false,
      updatedAt: null,
    });
    const listed = await call(jwt, "list_tags", {});
    expect({
      after: await toolNames(jwt),
      before,
      call: listed.isError,
    }).toStrictEqual({
      after: ["forget", "recall", "remember", "revise"],
      before: ["forget", "list_tags", "recall", "remember", "revise"],
      call: true,
    });
  });

  it("uses defaults when a stored config no longer parses", async () => {
    const log = vi.spyOn(console, "error").mockReturnValue();
    const memory = memoryFor(crypto.randomUUID());
    await runInDurableObject(memory, (_, state) => {
      state.storage.sql.exec(
        "INSERT INTO plugin_config (name, enabled, config, updated_at) VALUES ('size-limit', 1, '{\"hard\":\"big\"}', 1)"
      );
    });
    await evictDurableObject(memory);
    const [sizeLimit] = await views(await memory.listPlugins());
    expect(sizeLimit).toMatchObject({
      config: { hard: 500, soft: 300 },
      status: "invalid",
    });
    log.mockRestore();
  });

  it("updates and resets over HTTP with the same request guards as writes", async () => {
    const jwt = await token();
    const body = JSON.stringify({
      config: { hard: 40, soft: 20 },
      enabled: true,
      updatedAt: null,
    });
    const statuses = await Promise.all([
      send("PUT", "size-limit", jwt, body, { "Content-Type": "text/plain" }),
      send("PUT", "size-limit", jwt, body, { Origin: "https://evil.test" }),
      send("PUT", "size-limit", jwt, '{"enabled":true}'),
      send("PUT", "missing", jwt, body),
    ]).then((responses) => responses.map((response) => response.status));
    const saved = await send("PUT", "size-limit", jwt, body);
    const [custom] = await getPlugins(jwt);
    const reset = await send("DELETE", "size-limit", jwt);
    const [restored] = await getPlugins(jwt);
    expect({
      custom: custom?.status,
      reset: reset.status,
      restored: restored?.status,
      saved: saved.status,
      statuses,
    }).toStrictEqual({
      custom: "custom",
      reset: 200,
      restored: "default",
      saved: 200,
      statuses: [415, 403, 400, 404],
    });
  });
});
