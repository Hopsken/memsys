import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { JSONValue } from "hono/utils/types";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import worker from "../src/index";
import type { Fragment } from "../src/memory";

const issuer = "https://memsys-test.cloudflareaccess.com";
const bindings = { ...env, ACCESS_AUD: "memory-app", ACCESS_ISSUER: issuer };

const request = (path: string, body: JSONValue, jwt: string) =>
  worker.fetch(
    new Request(`https://memsys.test${path}`, {
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json, text/event-stream",
        "Cf-Access-Jwt-Assertion": jwt,
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
    bindings
  );

const call = async (
  jwt: string,
  name: string,
  args: Record<string, string>
) => {
  const response = await request(
    "/mcp",
    {
      id: 3,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: args, name },
    },
    jwt
  );
  expect(response.headers.has("mcp-session-id")).toBeFalsy();
  return response.json<{
    result: { content: { text: string }[]; isError?: boolean };
  }>();
};

describe("Worker", () => {
  let privateKey: CryptoKey;
  const token = (subject: string) =>
    new SignJWT({ type: "app" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience("memory-app")
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    ({ privateKey } = pair);
    const key = await exportJWK(pair.publicKey);
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (String(url) !== `${issuer}/cdn-cgi/access/certs`) {
        throw new Error("Unexpected network request");
      }
      return Promise.resolve(
        Response.json({
          keys: [{ ...key, alg: "RS256", kid: "test-key", use: "sig" }],
        })
      );
    });
  });

  afterAll(() => vi.restoreAllMocks());

  it("fails closed without configuration or a verified assertion", async () => {
    const url = "https://memsys.test/api/remember";
    await expect(
      worker.fetch(new Request(url), {
        ...env,
        ACCESS_AUD: "",
        ACCESS_ISSUER: "",
      })
    ).resolves.toMatchObject({
      status: 503,
    });
    await expect(
      worker.fetch(
        new Request(url, {
          headers: {
            "Cf-Access-Authenticated-User-Email": "spoof@example.com",
          },
        }),
        bindings
      )
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      request("/api/remember", { fragment: "secret" }, "forged")
    ).resolves.toMatchObject({ status: 401 });
  });

  it.each([
    { aud: "other" },
    { iss: "https://other.cloudflareaccess.com" },
    { exp: 1 },
    { sub: "" },
    { type: "org" },
    { nbf: 9_999_999_999 },
  ])("rejects invalid JWT claims: %j", async (claims) => {
    const jwt = await new SignJWT({
      aud: "memory-app",
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000),
      iss: issuer,
      sub: "alice",
      type: "app",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .sign(privateKey);
    await expect(
      request("/api/recall", { cue: "secret" }, jwt)
    ).resolves.toMatchObject({ status: 401 });
  });

  it("rejects a valid-looking token signed by another key", async () => {
    const other = await generateKeyPair("RS256");
    const jwt = await new SignJWT({ type: "app" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience("memory-app")
      .setSubject("alice")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(other.privateKey);
    await expect(
      request("/api/recall", { cue: "secret" }, jwt)
    ).resolves.toMatchObject({ status: 401 });
  });

  it("isolates reads, revisions, and deletions between identities", async () => {
    const created = await request(
      "/api/remember",
      { fragment: "Private design #project/a" },
      await token("rest-alice")
    );
    const item = await created.json<Fragment>();
    const bob = await token("rest-bob");
    const found = await request("/api/recall", { cue: "private" }, bob);
    await expect(found.json()).resolves.toMatchObject({
      associated: [],
      recalled: [],
    });
    await expect(
      request("/api/revise", { fragment: "stolen", ref: item.ref }, bob)
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      request("/api/forget", { ref: item.ref }, bob)
    ).resolves.toMatchObject({ status: 404 });
    const original = await request(
      "/api/recall",
      { cue: "private" },
      await token("rest-alice")
    );
    await expect(original.json()).resolves.toMatchObject({
      recalled: [{ fragment: "Private design #project/a", ref: item.ref }],
    });
  });

  it("creates and revises fragments with stable short refs and creation times", async () => {
    const jwt = await token("rest-edit");
    const created = await request(
      "/api/remember",
      { fragment: "Original" },
      jwt
    );
    expect(created.status).toBe(201);
    const item = await created.json<Fragment>();
    expect(item.ref).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{7}$/u);
    const revised = await request(
      "/api/revise",
      { fragment: "Changed design #project/b", ref: item.ref },
      jwt
    );
    await expect(revised.json()).resolves.toMatchObject({
      createdAt: item.createdAt,
      fragment: "Changed design #project/b",
      ref: item.ref,
    });
    const found = await request(
      "/api/recall",
      { cue: "changed design" },
      await token("rest-edit")
    );
    await expect(found.json()).resolves.toMatchObject({
      recalled: [{ anchors: ["project/b"], ref: item.ref }],
    });
  });

  it("forgets a fragment and reports missing refs", async () => {
    const jwt = await token("rest-forget");
    const created = await request(
      "/api/remember",
      { fragment: "Delete this" },
      jwt
    );
    const { ref } = await created.json<Fragment>();
    await expect(request("/api/forget", { ref }, jwt)).resolves.toMatchObject({
      status: 200,
    });
    await expect(request("/api/forget", { ref }, jwt)).resolves.toMatchObject({
      status: 404,
    });
    await expect(
      request("/api/revise", { fragment: "Gone", ref }, jwt)
    ).resolves.toMatchObject({ status: 404 });
    const found = await request("/api/recall", { cue: "Delete this" }, jwt);
    await expect(found.json()).resolves.toMatchObject({ recalled: [] });
  });

  it.each([
    ["/api/remember", { fragment: "" }, 400],
    ["/api/remember", { fragment: " \n " }, 400],
    ["/api/remember", { fragment: 12 }, 400],
    ["/api/remember", { fragment: "x".repeat(4096) }, 201],
    ["/api/remember", { fragment: "x".repeat(4097) }, 400],
    ["/api/remember", { fragment: "x".repeat(33_000) }, 413],
    ["/api/remember", { fragment: "x", space: "another-user" }, 400],
    ["/api/recall", { cue: " " }, 400],
    ["/api/forget", { ref: "invalid!" }, 400],
  ] satisfies [string, JSONValue, number][])(
    "validates input case %#",
    async (path, body, status) => {
      await expect(
        request(path, body, await token("validation"))
      ).resolves.toMatchObject({ status });
    }
  );

  it("rejects malformed JSON", async () => {
    const jwt = await token("malformed");
    await expect(
      worker.fetch(
        new Request("https://memsys.test/api/remember", {
          body: "{",
          headers: {
            "Cf-Access-Jwt-Assertion": jwt,
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
        bindings
      )
    ).resolves.toMatchObject({ status: 400 });
  });

  it("rebuilds from SQLite and updates associations after revise and forget", async () => {
    const memory = env.MEMORY.getByName("persistence");
    const seed = await memory.remember({
      fragment: "Durable objects #Cloudflare",
    });
    const neighbor = await memory.remember({
      fragment: "Workers #cloudflare #other",
    });
    await memory.remember({ fragment: "Not transitive #other" });
    await evictDurableObject(memory);
    await expect(
      memory.recall({ cue: " DURABLE\nobjects " })
    ).resolves.toMatchObject({
      associated: [{ ref: neighbor.ref, sharedAnchors: ["cloudflare"] }],
      recalled: [{ anchors: ["cloudflare"], ref: seed.ref }],
    });
    await memory.revise({ fragment: "Workers #changed", ref: neighbor.ref });
    await evictDurableObject(memory);
    await expect(
      memory.recall({ cue: "Durable objects" })
    ).resolves.toMatchObject({ associated: [] });
    await runInDurableObject(memory, (instance, state) => {
      const before = [
        ...state.storage.sql.exec("SELECT * FROM fragments ORDER BY id"),
      ];
      instance.recall({ cue: "Durable objects" });
      expect([
        ...state.storage.sql.exec("SELECT * FROM fragments ORDER BY id"),
      ]).toStrictEqual(before);
      expect([
        ...state.storage.sql.exec(
          "SELECT content FROM fragments WHERE id = ?",
          neighbor.ref
        ),
      ]).toStrictEqual([{ content: "Workers #changed" }]);
    });
    await memory.forget({ ref: seed.ref });
    await evictDurableObject(memory);
    await expect(
      memory.recall({ cue: "Durable objects" })
    ).resolves.toMatchObject({ associated: [], recalled: [] });
  });

  it("initializes MCP without a session and lists exactly four tools", async () => {
    const jwt = await token("mcp-init");
    const init = await request(
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
      result: { serverInfo: { name: "memsys" } },
    });
    const list = await request(
      "/mcp",
      { id: 2, jsonrpc: "2.0", method: "tools/list" },
      jwt
    );
    const tools = await list.json<{ result: { tools: { name: string }[] } }>();
    expect(
      tools.result.tools.map((tool) => tool.name).toSorted()
    ).toStrictEqual(["forget", "recall", "remember", "revise"]);
  });

  it("runs all MCP tools without initialization and shares memory with REST", async () => {
    const jwt = await token("mcp-tools");
    const saved = await call(jwt, "remember", { fragment: "MCP memory #test" });
    const item = z
      .object({ fragment: z.string(), ref: z.string() })
      .parse(JSON.parse(saved.result.content[0]?.text ?? ""));
    expect(item.fragment).toBe("MCP memory #test");
    const rest = await request("/api/recall", { cue: "MCP memory" }, jwt);
    await expect(rest.json()).resolves.toMatchObject({
      recalled: [{ ref: item.ref }],
    });
    await call(jwt, "revise", { fragment: "Revised MCP #new", ref: item.ref });
    const found = await call(jwt, "recall", { cue: "Revised MCP" });
    expect(JSON.parse(found.result.content[0]?.text ?? "")).toMatchObject({
      recalled: [{ anchors: ["new"], ref: item.ref }],
    });
    await call(jwt, "forget", { ref: item.ref });
    await expect(
      call(jwt, "revise", { fragment: "Gone", ref: item.ref })
    ).resolves.toMatchObject({ result: { isError: true } });
    await expect(
      call(jwt, "remember", { fragment: " " })
    ).resolves.toMatchObject({ result: { isError: true } });
  });

  it("accepts MCP notifications and rejects GET and DELETE", async () => {
    const jwt = await token("mcp-methods");
    await expect(
      request(
        "/mcp",
        { jsonrpc: "2.0", method: "notifications/initialized" },
        jwt
      )
    ).resolves.toMatchObject({ status: 202 });
    const responses = await Promise.all(
      ["GET", "DELETE"].map((method) =>
        worker.fetch(
          new Request("https://memsys.test/mcp", {
            headers: { "Cf-Access-Jwt-Assertion": jwt },
            method,
          }),
          bindings
        )
      )
    );
    expect(responses.map((response) => response.status)).toStrictEqual([
      405, 405,
    ]);
  });
});
