import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { Fragment } from "../contract/memory";
import worker from "../worker/index";
import { call, content, list, post, useAuth } from "./helpers";
import type { User } from "./helpers";

const tags = async (user: User) =>
  content<string[]>(await call(user, "list_tags", {}));

describe("Stateless MCP", () => {
  const signIn = useAuth();

  it("initializes without a session and advertises the supported tools", async () => {
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
    await expect(init.json()).resolves.toMatchObject({
      result: { capabilities: { tools: {} }, protocolVersion: "2025-03-26" },
    });
    const response = await post(
      "/mcp",
      { id: 2, jsonrpc: "2.0", method: "tools/list" },
      user
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
    const user = await signIn();
    const item = content<Fragment>(
      await call(user, "remember", { fragment: "MCP memory #test" })
    );
    expect(item.fragment).toBe("MCP memory #test");
    await expect(list(user)).resolves.toStrictEqual({
      fragments: [item],
      nextCursor: null,
    });
    const found = await call(user, "recall", { cue: "MCP memory" });
    expect(content(found)).toStrictEqual({ fragments: [item], hasMore: false });
    expect(
      content(await call(user, "forget", { ref: item.ref }))
    ).toStrictEqual({ ref: item.ref });
    await expect(list(user)).resolves.toStrictEqual({
      fragments: [],
      nextCursor: null,
    });
  });

  it("lists complete, unique tags from current memory with identity isolation", async () => {
    const user = await signIn();
    const other = await signIn();
    await expect(tags(user)).resolves.toStrictEqual([]);
    const first = content<Fragment>(
      await call(user, "remember", {
        fragment: "First #Zeta #PROJECT/One #Agents",
      })
    );
    const second = content<Fragment>(
      await call(user, "remember", {
        fragment: "Second #zeta #记忆 #agent-memory",
      })
    );
    await call(other, "remember", { fragment: "Other user #private" });
    await expect(Promise.all([tags(user), tags(other)])).resolves.toStrictEqual(
      [["agent-memory", "agents", "project/one", "zeta", "记忆"], ["private"]]
    );
    await call(user, "revise", {
      fragment: "Updated #beta #PROJECT/Two",
      ref: first.ref,
    });
    await expect(tags(user)).resolves.toStrictEqual([
      "agent-memory",
      "beta",
      "project/two",
      "zeta",
      "记忆",
    ]);
    await call(user, "forget", { ref: second.ref });
    await expect(tags(user)).resolves.toStrictEqual(["beta", "project/two"]);
    await expect(
      call(user, "list_tags", { unexpected: true })
    ).resolves.toMatchObject({ isError: true });
  });

  it("returns tool errors for invalid input and missing fragments", async () => {
    const user = await signIn();
    await expect(
      call(user, "remember", { fragment: " " })
    ).resolves.toMatchObject({ isError: true });
    await expect(
      call(user, "forget", { ref: "2222222" })
    ).resolves.toMatchObject({ isError: true });
    await expect(
      call(user, "revise", { fragment: "new", ref: "2222222" })
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
