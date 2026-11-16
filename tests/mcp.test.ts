import type { Fragment } from "@core";
import { env } from "cloudflare:workers";
import type { JSONValue } from "hono/utils/types";
import { describe, expect, it } from "vitest";

import worker from "../worker/index";
import { SERVER_INSTRUCTIONS } from "../worker/routes/mcp-prompts";
import { faux } from "./faux-provider";
import {
  call,
  list,
  patchSettings,
  post,
  text,
  useAuth,
  withVersions,
} from "./helpers";
import type { User } from "./helpers";
import { scripted, useFauxModel } from "./subagent";

const toolNames = async (user: User) => {
  const response = await post(
    "/mcp",
    { id: 1, jsonrpc: "2.0", method: "tools/list" },
    user
  );
  const { result } = await response.json<{
    result: {
      tools: { annotations?: { readOnlyHint?: boolean }; name: string }[];
    };
  }>();
  return result.tools;
};

const withoutInitialize = (
  user: User,
  method: string,
  params: Record<string, JSONValue> = {},
  { name, version = "2026-07-28" }: { name?: string; version?: string } = {}
) =>
  post(
    "/mcp",
    {
      id: 1,
      jsonrpc: "2.0",
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
          "io.modelcontextprotocol/protocolVersion": version,
        },
      },
    },
    user,
    {
      "MCP-Protocol-Version": version,
      "Mcp-Method": method,
      ...(name && { "Mcp-Name": name }),
    }
  );

describe("Stateless MCP", () => {
  const signIn = useAuth();
  useFauxModel();

  it("initializes without a session and advertises exactly recall and note", async () => {
    const user = await signIn();
    const init = await post(
      "/mcp",
      {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
          protocolVersion: "2025-03-26",
        },
      },
      user
    );
    expect(init.status).toBe(200);
    expect(init.headers.has("mcp-session-id")).toBeFalsy();
    const { result } = await init.json<{
      result: {
        capabilities: unknown;
        instructions: string;
        protocolVersion: string;
      };
    }>();
    expect(result).toMatchObject({
      capabilities: { tools: {} },
      protocolVersion: "2025-03-26",
    });
    expect(result.instructions).toBe(SERVER_INSTRUCTIONS);
    const tools = await toolNames(user);
    expect({
      names: tools.map((tool) => tool.name).toSorted(),
      readOnly: tools.flatMap((tool) =>
        tool.annotations?.readOnlyHint ? [tool.name] : []
      ),
    }).toStrictEqual({ names: ["note", "recall"], readOnly: ["recall"] });
  });

  it("keeps owner instructions out of the server instructions", async () => {
    const user = await signIn();
    await patchSettings(user, { instructions: "Answer in French." });
    const response = await post(
      "/mcp",
      {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
          protocolVersion: "2025-03-26",
        },
      },
      user
    );
    const { result } = await response.json<{
      result: { instructions: string };
    }>();
    expect(result.instructions).toBe(SERVER_INSTRUCTIONS);
  });

  it("serves the 2026-07-28 protocol without a handshake", async () => {
    const user = await signIn();
    const discover = await withoutInitialize(user, "server/discover");
    expect(discover.status).toBe(200);
    await expect(discover.json()).resolves.toMatchObject({
      result: {
        capabilities: { tools: {} },
        supportedVersions: expect.arrayContaining(["2026-07-28"]),
      },
    });
    const listed = await withoutInitialize(user, "tools/list");
    const { result } = await listed.json<{
      result: { tools: { name: string }[] };
    }>();
    expect(result.tools.map((tool) => tool.name)).toContain("recall");
    const script = scripted();
    faux.setResponses([script.text("Modern MCP works.")]);
    const recalled = await withoutInitialize(
      user,
      "tools/call",
      { arguments: { context: "Does modern MCP work?" }, name: "recall" },
      { name: "recall" }
    );
    const { result: tool } = await recalled.json<{
      result: { content: { text: string }[] };
    }>();
    expect(text(tool)).toBe("Modern MCP works.");
  });

  it("rejects an unsupported protocol version with 400, so clients fall back to initialize", async () => {
    const user = await signIn();
    const response = await withoutInitialize(
      user,
      "server/discover",
      {},
      { version: "2099-01-01" }
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { data: { supported: expect.arrayContaining(["2026-07-28"]) } },
    });
  });

  it("answers recall in prose without writing", async () => {
    const user = await signIn();
    const saved = await post(
      "/api/remember",
      { fragment: "Deploys go through wrangler #ops" },
      user
    );
    const item = await saved.json<Fragment>();
    const script = scripted();
    faux.setResponses([script.text("Deploys go through wrangler.")]);
    const recalled = await call(user, "recall", {
      context: "How do deploys work?",
    });
    expect(recalled.isError).toBeUndefined();
    expect(text(recalled)).toBe("Deploys go through wrangler.");
    expect(script.requests).toHaveLength(1);
    expect(script.requests[0]?.options).toMatchObject({
      reasoning: "high",
      toolChoice: "none",
    });
    // Recall sent no write tool call, and the stored memory is unchanged.
    await expect(list(user)).resolves.toStrictEqual({
      fragments: [withVersions(item, 1, "user")],
      nextCursor: null,
    });
  });

  it("writes through note under the caller's source and returns a receipt", async () => {
    const user = await signIn();
    const script = scripted();
    faux.setResponses([
      script.tool("remember", { fragment: "Prefers pnpm over npm" }),
      script.text("Stored that preference."),
    ]);
    const noted = await call(user, "note", {
      context: "I prefer pnpm over npm.",
    });
    expect(noted.isError).toBeUndefined();
    expect(text(noted)).toBe("Memory updated: remembered 1 memory.");
    const page = await list(user);
    expect(page.fragments).toHaveLength(1);
    expect(page.fragments[0]).toMatchObject({
      fragment: "Prefers pnpm over npm",
      source: "agent:test",
    });
    expect(script.requests[1]?.options).toMatchObject({
      reasoning: "high",
      toolChoice: "auto",
    });
  });

  it("revises and forgets through note", async () => {
    const user = await signIn();
    const firstResponse = await post(
      "/api/remember",
      { fragment: "Deploys use npm" },
      user
    );
    const secondResponse = await post(
      "/api/remember",
      { fragment: "Old phone number" },
      user
    );
    const first = await firstResponse.json<Fragment>();
    const second = await secondResponse.json<Fragment>();
    const script = scripted();
    faux.setResponses([
      script.tool("revise", {
        fragment: "Deploys use pnpm",
        ref: first.ref,
      }),
      script.tool("forget", { ref: second.ref }),
      script.text("Updated both."),
    ]);
    const noted = await call(user, "note", {
      context: "Deploys switched to pnpm, and the old phone number is gone.",
    });
    expect(text(noted)).toBe(
      "Memory updated: revised 1 memory, forgot 1 memory."
    );
    const page = await list(user);
    expect(page.fragments).toHaveLength(1);
    expect(page.fragments[0]).toMatchObject({
      fragment: "Deploys use pnpm",
      ref: first.ref,
      source: "agent:test",
    });
  });

  it("returns the model failure without writing", async () => {
    const user = await signIn();
    const script = scripted();
    faux.setResponses([script.fail("upstream is down")]);
    const recalled = await call(user, "recall", { context: "anything" });
    expect(recalled.isError).toBeTruthy();
    expect(text(recalled)).toContain("Retry this call shortly");
    const noted = await call(user, "note", { context: "anything" });
    expect(noted.isError).toBeTruthy();
    await expect(list(user)).resolves.toStrictEqual({
      fragments: [],
      nextCursor: null,
    });
  });

  it("rejects invalid input", async () => {
    const user = await signIn();
    await expect(call(user, "recall", {})).resolves.toMatchObject({
      isError: true,
    });
    await expect(
      call(user, "recall", { context: "   " })
    ).resolves.toMatchObject({ isError: true });
    await expect(
      call(user, "note", { context: "x", extra: true })
    ).resolves.toMatchObject({ isError: true });
    await expect(
      call(user, "note", { context: "x".repeat(8001) })
    ).resolves.toMatchObject({ isError: true });
  });

  it("accepts notifications and rejects GET and DELETE", async () => {
    const user = await signIn();
    await expect(
      post(
        "/mcp",
        { jsonrpc: "2.0", method: "notifications/initialized" },
        user
      )
    ).resolves.toMatchObject({ status: 202 });
    const responses = await Promise.all(
      ["GET", "DELETE"].map((method) =>
        worker.fetch(
          new Request("https://memsys.test/mcp", {
            headers: { Authorization: `Bearer ${user.token}` },
            method,
          }),
          env
        )
      )
    );
    expect(
      responses.map((response) => [
        response.status,
        response.headers.get("Allow"),
      ])
    ).toStrictEqual([
      [405, "POST"],
      [405, "POST"],
    ]);
  });
});
