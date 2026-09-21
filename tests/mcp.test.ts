import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import worker from "../worker/index";
import type { Fragment } from "../worker/memory";
import { call, content, list, post, useAccess } from "./helpers";

const tags = async (jwt: string) =>
  content<string[]>(await call(jwt, "list_tags", {}));

describe("Stateless MCP", () => {
  const token = useAccess();

  it("initializes without a session and advertises the supported tools", async () => {
    const jwt = await token();
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
      jwt
    );
    expect(init.status).toBe(200);
    expect(init.headers.has("mcp-session-id")).toBeFalsy();
    await expect(init.json()).resolves.toMatchObject({
      result: { capabilities: { tools: {} }, protocolVersion: "2025-03-26" },
    });
    const response = await post(
      "/mcp",
      { id: 2, jsonrpc: "2.0", method: "tools/list" },
      jwt
    );
    const { result } = await response.json<{
      result: {
        tools: { name: string; annotations?: { readOnlyHint?: boolean } }[];
      };
    }>();
    expect(result.tools.map((tool) => tool.name).toSorted()).toStrictEqual([
      "forget",
      "list_tags",
      "recall",
      "remember",
      "revise",
    ]);
    expect(
      result.tools
        .filter((tool) => tool.annotations?.readOnlyHint)
        .map((tool) => tool.name)
        .toSorted()
    ).toStrictEqual(["list_tags", "recall"]);
  });

  it("shares writes, recall, and deletion with REST without initialization", async () => {
    const jwt = await token();
    const item = content<Fragment>(
      await call(jwt, "remember", { fragment: "MCP memory #test" })
    );
    expect(item.fragment).toBe("MCP memory #test");
    await expect(list(jwt)).resolves.toStrictEqual({
      fragments: [item],
      nextCursor: null,
    });
    const found = await call(jwt, "recall", { cue: "MCP memory" });
    expect(content(found)).toMatchObject({
      recalled: [{ ...item, anchors: ["test"] }],
    });
    expect(content(await call(jwt, "forget", { ref: item.ref }))).toStrictEqual(
      { ref: item.ref }
    );
    await expect(list(jwt)).resolves.toStrictEqual({
      fragments: [],
      nextCursor: null,
    });
  });

  it("lists complete, unique tags from current memory with identity isolation", async () => {
    const jwt = await token();
    const other = await token();
    await expect(tags(jwt)).resolves.toStrictEqual([]);
    const first = content<Fragment>(
      await call(jwt, "remember", {
        fragment: "First #Zeta #PROJECT/One #Agents",
      })
    );
    const second = content<Fragment>(
      await call(jwt, "remember", {
        fragment: "Second #zeta #记忆 #agent-memory",
      })
    );
    await call(other, "remember", { fragment: "Other user #private" });
    await expect(Promise.all([tags(jwt), tags(other)])).resolves.toStrictEqual([
      ["agent-memory", "agents", "project/one", "zeta", "记忆"],
      ["private"],
    ]);
    await call(jwt, "revise", {
      new_string: "Updated #beta #PROJECT/Two",
      old_string: first.fragment,
      ref: first.ref,
    });
    await expect(tags(jwt)).resolves.toStrictEqual([
      "agent-memory",
      "beta",
      "project/two",
      "zeta",
      "记忆",
    ]);
    await call(jwt, "forget", { ref: second.ref });
    await expect(tags(jwt)).resolves.toStrictEqual(["beta", "project/two"]);
    await expect(
      call(jwt, "list_tags", { unexpected: true })
    ).resolves.toMatchObject({ isError: true });
  });

  it("returns tool errors for invalid input and missing fragments", async () => {
    const jwt = await token();
    await expect(
      call(jwt, "remember", { fragment: " " })
    ).resolves.toMatchObject({ isError: true });
    await expect(
      call(jwt, "forget", { ref: "2222222" })
    ).resolves.toMatchObject({ isError: true });
    await expect(
      call(jwt, "revise", {
        new_string: "new",
        old_string: "old",
        ref: "2222222",
      })
    ).resolves.toMatchObject({ isError: true });
  });

  it("accepts notifications and rejects GET and DELETE", async () => {
    const jwt = await token();
    await expect(
      post("/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }, jwt)
    ).resolves.toMatchObject({ status: 202 });
    const responses = await Promise.all(
      ["GET", "DELETE"].map((method) =>
        worker.fetch(
          new Request("https://memsys.test/mcp", {
            headers: { "Cf-Access-Jwt-Assertion": jwt },
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
