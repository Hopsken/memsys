import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { JSONValue } from "hono/utils/types";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import worker from "../worker/index";
import type { Fragment } from "../worker/memory";

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
  args: Record<string, string | boolean>
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

  const getList = (assertion: string, query = "") =>
    worker.fetch(
      new Request(`https://memsys.test/api/fragments${query}`, {
        headers: { "Cf-Access-Jwt-Assertion": assertion },
      }),
      bindings
    );

  it("lists only the verified user's fragments without caching or writes", async () => {
    const jwt = await token("list-owner");
    const saved = await request(
      "/api/remember",
      { fragment: "Private list item" },
      jwt
    );
    const item = await saved.json<Fragment>();
    const response = await getList(jwt);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toStrictEqual({
      fragments: [item],
      nextCursor: null,
    });
    const other = await getList(await token("list-other"));
    await expect(other.json()).resolves.toStrictEqual({
      fragments: [],
      nextCursor: null,
    });
    const memory = env.MEMORY.getByName(JSON.stringify([issuer, "list-owner"]));
    await evictDurableObject(memory);
    await expect(memory.list({})).resolves.toStrictEqual({
      fragments: [item],
      nextCursor: null,
    });
  });

  it("validates list authentication and query parameters", async () => {
    const jwt = await token("list-validation");
    await expect(getList("")).resolves.toMatchObject({ status: 401 });
    await expect(getList(jwt, "?cursor=invalid")).resolves.toMatchObject({
      status: 400,
    });
    await expect(getList(jwt, "?space=other")).resolves.toMatchObject({
      status: 400,
    });
    const memory = env.MEMORY.getByName(
      JSON.stringify([issuer, "list-validation"])
    );
    const item = await memory.remember({ fragment: "Cursor boundary" });
    const response = await getList(
      jwt,
      `?${new URLSearchParams({ cursor: `${item.updatedAt},${item.ref}` })}`
    );
    await expect(response.json()).resolves.toStrictEqual({
      fragments: [],
      nextCursor: null,
    });
  });

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

  it.each([42, true, {}, [], null])(
    "rejects signed non-string subjects: %j",
    async (sub) => {
      // Build malformed claims dynamically; the typed JWT API expects a string sub.
      const jwt = await new SignJWT(
        Object.fromEntries([
          ["sub", sub],
          ["type", "app"],
        ])
      )
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(issuer)
        .setAudience("memory-app")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      await expect(
        request("/api/recall", { cue: "secret" }, jwt)
      ).resolves.toMatchObject({ status: 401 });
    }
  );

  it.each(["/api/remember", "/api/revise", "/api/forget", "/mcp"])(
    "blocks cross-origin writes to %s with a valid assertion",
    async (path) => {
      const subject = `origin-${path}`;
      const memory = env.MEMORY.getByName(JSON.stringify([issuer, subject]));
      const item = await memory.remember({
        fragment: "Original guarded memory",
      });
      const before = await memory.recall({ cue: "memory" });
      const input =
        path === "/api/forget"
          ? { ref: item.ref }
          : {
              fragment: "Injected memory",
              ref: item.ref,
            };
      let body: JSONValue = input;
      if (path === "/mcp") {
        body = {
          id: 1,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: { fragment: "Injected memory" },
            name: "remember",
          },
        };
      } else if (path === "/api/remember") {
        body = { fragment: "Injected memory" };
      }
      const jwt = await token(subject);
      const responses = await Promise.all(
        ["application/json", "text/plain"].map((contentType) =>
          worker.fetch(
            new Request(`https://memsys.test${path}`, {
              body: JSON.stringify(body),
              headers: {
                Accept: "application/json",
                "Cf-Access-Jwt-Assertion": jwt,
                "Content-Type": contentType,
                Origin: "https://attacker.test",
                "Sec-Fetch-Site": "same-origin",
              },
              method: "POST",
            }),
            bindings
          )
        )
      );
      expect(responses.map((response) => response.status)).toStrictEqual([
        403, 403,
      ]);
      await expect(memory.recall({ cue: "memory" })).resolves.toStrictEqual(
        before
      );
    }
  );

  it.each(["null", "https://memsys.test.attacker.test", "http://memsys.test"])(
    "rejects untrusted Origin %s",
    async (origin) => {
      await expect(
        worker.fetch(
          new Request("https://memsys.test/mcp", {
            headers: { Origin: origin },
          }),
          bindings
        )
      ).resolves.toMatchObject({ status: 403 });
    }
  );

  it.each([
    "text/plain",
    "application/jsonp",
    "application/x-www-form-urlencoded",
    "",
  ])(
    "rejects REST media type %j without writing memory",
    async (contentType) => {
      const subject = `media-${contentType}`;
      const jwt = await token(subject);
      const headers = new Headers({
        "Cf-Access-Jwt-Assertion": jwt,
        Origin: "https://memsys.test",
      });
      if (contentType) {
        headers.set("Content-Type", contentType);
      }
      const response = await worker.fetch(
        new Request("https://memsys.test/api/remember", {
          body: new TextEncoder().encode(
            '{"fragment":"Injected media memory"}'
          ),
          headers,
          method: "POST",
        }),
        bindings
      );
      expect(response.status).toBe(415);
      const memory = env.MEMORY.getByName(JSON.stringify([issuer, subject]));
      await expect(memory.recall({ cue: "memory" })).resolves.toMatchObject({
        recalled: [],
      });
    }
  );

  it.each(["/api/remember", "/mcp"])(
    "accepts same-origin JSON requests to %s",
    async (path) => {
      const jwt = await token(`same-origin-${path}`);
      const body =
        path === "/mcp"
          ? { id: 1, jsonrpc: "2.0", method: "tools/list" }
          : { fragment: "Same-origin memory" };
      const response = await worker.fetch(
        new Request(`https://memsys.test${path}`, {
          body: JSON.stringify(body),
          headers: {
            Accept: "application/json",
            "Cf-Access-Jwt-Assertion": jwt,
            "Content-Type": "application/json; charset=utf-8",
            Origin: "https://memsys.test",
          },
          method: "POST",
        }),
        bindings
      );
      expect(response.status).toBe(path === "/mcp" ? 200 : 201);
    }
  );

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
      {
        fragment: "Changed design #project/b",
        ref: item.ref,
      },
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
    ["/api/revise", { fragment: " \n ", ref: "7x9c2pa" }, 400],
    ["/api/remember", { fragment: " \n " }, 400],
    ["/api/remember", { fragment: 12 }, 400],
    ["/api/remember", { fragment: "x".repeat(280) }, 201],
    ["/api/remember", { fragment: "x".repeat(281) }, 400],
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

  it.each(["REST", "MCP"])(
    "%s applies grapheme limits to remember and revise without changing stored text",
    async (transport) => {
      const jwt = await token(`grapheme-${transport}`);
      const writeResult = z.object({
        fragment: z.string(),
        ref: z.string(),
        warnings: z.array(z.string()).optional(),
      });
      const write = async (name: string, args: Record<string, string>) => {
        if (transport === "MCP") {
          const { fragment, ...edit } = args;
          const { result } = await call(
            jwt,
            name,
            name === "revise" ? { ...edit, new_string: fragment ?? "" } : args
          );
          return result.isError
            ? null
            : writeResult.parse(JSON.parse(result.content[0]?.text ?? ""));
        }
        const { old_string: _oldString, ...body } = args;
        const response = await request(`/api/${name}`, body, jwt);
        if (response.status === 400) {
          return null;
        }
        expect(response.status).toBe(name === "remember" ? 201 : 200);
        return response.json<z.infer<typeof writeResult>>();
      };

      // Six graphemes, but more UTF-16 units and Unicode code points.
      const unit = "中a👍🏽👨‍👩‍👧‍👦e\u0301🇨🇳";
      await Promise.all(
        [140, 141, 280].map(async (length) => {
          const fragment =
            unit.repeat(Math.floor(length / 6)) + "文".repeat(length % 6);
          const created = await write("remember", { fragment });
          expect(created?.fragment).toBe(fragment);
          const ref = created?.ref ?? "";
          const revised = await write("revise", {
            fragment,
            old_string: fragment,
            ref,
          });
          expect(revised?.fragment).toBe(fragment);
          for (const result of [created, revised]) {
            expect(result?.warnings).toStrictEqual(
              length > 140
                ? [
                    `Fragment contains ${length} characters, above the recommended 140. Consider splitting it into smaller fragments.`,
                  ]
                : undefined
            );
          }
          await expect(
            write("revise", {
              fragment: "中".repeat(281),
              old_string: fragment,
              ref,
            })
          ).resolves.toBeNull();
          const listed = await getList(jwt);
          const page = await listed.json<{ fragments: Fragment[] }>();
          const stored = page.fragments.find((item) => item.ref === ref);
          expect({
            fragment: stored?.fragment,
            hasWarnings: stored !== undefined && "warnings" in stored,
          }).toStrictEqual({ fragment, hasWarnings: false });
          const shortened = await write("revise", {
            fragment: "短",
            old_string: fragment,
            ref,
          });
          expect(shortened?.warnings).toBeUndefined();
        })
      );
      await expect(
        write("remember", { fragment: "中".repeat(281) })
      ).resolves.toBeNull();
      await expect(
        write("remember", { fragment: unit.repeat(47) })
      ).resolves.toBeNull();
      const listed = await getList(jwt);
      const page = await listed.json<{ fragments: Fragment[] }>();
      expect(page.fragments).toHaveLength(3);
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
      fragment: "Durable objects #Programming",
    });
    const neighbor = await memory.remember({
      fragment: "Workers #program #other",
    });
    await memory.remember({ fragment: "Not transitive #other" });
    await evictDurableObject(memory);
    await expect(
      memory.recall({ cue: " DURABLE\nobjects " })
    ).resolves.toMatchObject({
      associated: [{ ref: neighbor.ref, sharedAnchors: ["program"] }],
      recalled: [{ anchors: ["programming"], ref: seed.ref }],
    });
    await memory.revise({
      new_string: "Workers #changed",
      old_string: neighbor.fragment,
      ref: neighbor.ref,
    });
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

  it("initializes MCP without a session and lists exactly five tools", async () => {
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

    const list = await request(
      "/mcp",
      { id: 2, jsonrpc: "2.0", method: "tools/list" },
      jwt
    );
    const tools = await list.json<{
      result: {
        tools: {
          annotations?: { readOnlyHint?: boolean };
          description: string;
          name: string;
          inputSchema: {
            required?: string[];
          };
        }[];
      };
    }>();
    const toolsByName = Object.fromEntries(
      tools.result.tools.map((tool) => [tool.name, tool])
    );
    expect({
      descriptions: Object.fromEntries(
        tools.result.tools.map((tool) => [tool.name, tool.description])
      ),
      listTags: {
        annotations: toolsByName.list_tags?.annotations,
        inputSchema: toolsByName.list_tags?.inputSchema,
      },
      names: tools.result.tools.map((tool) => tool.name).toSorted(),
      reviseRequired: toolsByName.revise?.inputSchema.required?.toSorted(),
    }).toStrictEqual({
      descriptions: {
        forget:
          "Delete a known memory that is obsolete, incorrect, duplicated, or explicitly requested to be forgotten.",
        list_tags:
          "List all unique #anchor names currently used in this memory store, in stable alphabetical order.",
        recall:
          "Recall memories using a short textual cue. Prefer distinctive phrases, entities, or concepts. Related fragments may also be returned through shared #anchors.",
        remember:
          "Store one durable, independently recallable memory fragment. Keep it atomic, self-contained, and concise. Split multiple ideas into separate fragments. Use #anchors to link related memories.",
        revise:
          "Replace a known memory when its information has changed or needs correction. Keep the replacement atomic and self-contained.",
      },
      listTags: {
        annotations: { readOnlyHint: true },
        inputSchema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          additionalProperties: false,
          properties: {},
          type: "object",
        },
      },
      names: ["forget", "list_tags", "recall", "remember", "revise"],
      reviseRequired: ["new_string", "old_string", "ref"],
    });
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
    await call(jwt, "revise", {
      new_string: "Revised MCP #new",
      old_string: "MCP memory #test",
      ref: item.ref,
    });
    const found = await call(jwt, "recall", { cue: "Revised MCP" });
    expect(JSON.parse(found.result.content[0]?.text ?? "")).toMatchObject({
      recalled: [{ anchors: ["new"], ref: item.ref }],
    });
    await call(jwt, "forget", { ref: item.ref });
    await expect(
      call(jwt, "revise", {
        new_string: "Gone",
        old_string: "Revised",
        ref: item.ref,
      })
    ).resolves.toMatchObject({ result: { isError: true } });
    await expect(
      call(jwt, "remember", { fragment: " " })
    ).resolves.toMatchObject({ result: { isError: true } });
  });

  it("lists current tags through MCP with isolation and no parameters", async () => {
    const jwt = await token("mcp-tags");
    const otherJwt = await token("mcp-tags-other");
    const tags = async (assertion: string) => {
      const response = await call(assertion, "list_tags", {});
      return z
        .array(z.string())
        .parse(JSON.parse(response.result.content[0]?.text ?? ""));
    };

    const initially = await tags(jwt);
    const first = await call(jwt, "remember", {
      fragment: "First #Zeta #PROJECT/One #Agents",
    });
    const firstItem = z
      .object({ fragment: z.string(), ref: z.string() })
      .parse(JSON.parse(first.result.content[0]?.text ?? ""));
    const second = await call(jwt, "remember", {
      fragment: "Second #zeta #记忆 #agent-memory",
    });
    const secondItem = z
      .object({ ref: z.string() })
      .parse(JSON.parse(second.result.content[0]?.text ?? ""));
    const current = await tags(jwt);
    expect({ current, initially }).toStrictEqual({
      current: ["agent-memory", "agents", "project/one", "zeta", "记忆"],
      initially: [],
    });

    await call(otherJwt, "remember", { fragment: "Other user #private" });
    await expect(
      Promise.all([tags(jwt), tags(otherJwt)])
    ).resolves.toStrictEqual([
      ["agent-memory", "agents", "project/one", "zeta", "记忆"],
      ["private"],
    ]);

    await call(jwt, "revise", {
      new_string: "Updated #beta #PROJECT/Two",
      old_string: firstItem.fragment,
      ref: firstItem.ref,
    });
    await expect(tags(jwt)).resolves.toStrictEqual([
      "agent-memory",
      "beta",
      "project/two",
      "zeta",
      "记忆",
    ]);
    await call(jwt, "forget", { ref: secondItem.ref });
    await expect(tags(jwt)).resolves.toStrictEqual(["beta", "project/two"]);
    await expect(
      call(jwt, "list_tags", { unexpected: true })
    ).resolves.toMatchObject({ result: { isError: true } });
  });

  it("edits literal text through MCP while preserving surrounding content and REST replacement", async () => {
    const jwt = await token("mcp-edit");
    const response = await request(
      "/api/remember",
      { fragment: "Before\n旧内容 #old\nAfter" },
      jwt
    );
    const item = await response.json<Fragment>();
    const edited = await call(jwt, "revise", {
      new_string: "$& $1 $` $' #new",
      old_string: "旧内容 #old",
      ref: item.ref,
    });
    expect(JSON.parse(edited.result.content[0]?.text ?? "")).toMatchObject({
      createdAt: item.createdAt,
      fragment: "Before\n$& $1 $` $' #new\nAfter",
      ref: item.ref,
    });
    const deleted = await call(jwt, "revise", {
      new_string: "",
      old_string: "$& $1 $` $' ",
      ref: item.ref,
    });
    expect(JSON.parse(deleted.result.content[0]?.text ?? "").fragment).toBe(
      "Before\n#new\nAfter"
    );
    const rest = await request(
      "/api/revise",
      {
        fragment: "REST replacement",
        ref: item.ref,
      },
      jwt
    );
    expect(rest.status).toBe(200);
    await expect(rest.json()).resolves.toMatchObject({
      fragment: "REST replacement",
    });
    const boundary = await call(jwt, "revise", {
      new_string: "x".repeat(280),
      old_string: "REST replacement",
      ref: item.ref,
    });
    expect(JSON.parse(boundary.result.content[0]?.text ?? "").fragment).toBe(
      "x".repeat(280)
    );
  });

  it.each([
    ["Case  sensitive", "case  sensitive", "new", "not found"],
    ["Case  sensitive", "Case sensitive", "new", "not found"],
    ["one one", "one", "new", "more than once"],
    ["aaa", "aa", "new", "more than once"],
    ["remove", "remove", "", "non-whitespace"],
    ["remove", "remove", " \n", "non-whitespace"],
    ["ab", "a", "x".repeat(280), "280"],
    ["keep", "", "new", ""],
  ])(
    "rejects invalid MCP edits without changing stored content (%#)",
    async (fragment, oldString, newString, error) => {
      const jwt = await token("mcp-edit-errors");
      const response = await request("/api/remember", { fragment }, jwt);
      const item = await response.json<Fragment>();
      const edited = await call(jwt, "revise", {
        new_string: newString,
        old_string: oldString,
        ref: item.ref,
      });
      expect(edited.result.isError).toBeTruthy();
      expect(edited.result.content[0]?.text).toContain(error);
      const recalled = await request("/api/recall", { cue: fragment }, jwt);
      const data = await recalled.json<{ recalled: Fragment[] }>();
      expect(
        data.recalled.find((entry) => entry.ref === item.ref)
      ).toMatchObject(item);
    }
  );

  it.each([
    ["a #old b #old c", "#old", "$& #new", "a $& #new b $& #new c"],
    ["aaa", "aa", "x", "xa"],
    ["a-a-b", "a-", "", "b"],
  ])(
    "replaces all non-overlapping literal matches (%#)",
    async (fragment, oldString, newString, expected) => {
      const jwt = await token("mcp-replace-all");
      const response = await request("/api/remember", { fragment }, jwt);
      const item = await response.json<Fragment>();
      const revised = await call(jwt, "revise", {
        new_string: newString,
        old_string: oldString,
        ref: item.ref,
        replaceAll: true,
      });
      expect(JSON.parse(revised.result.content[0]?.text ?? "")).toMatchObject({
        createdAt: item.createdAt,
        fragment: expected,
        ref: item.ref,
      });
      const recalled = await request("/api/recall", { cue: expected }, jwt);
      const data = await recalled.json<{ recalled: Fragment[] }>();
      expect(
        data.recalled.find((entry) => entry.ref === item.ref)
      ).toMatchObject({
        fragment: expected,
        ref: item.ref,
      });
    }
  );

  it.each([
    ["a a", "a", "b", false],
    ["a a", "missing", "b", true],
    ["aa", "a", "x".repeat(141), true],
    ["aa", "a", "", true],
  ])(
    "leaves memory unchanged when replaceAll cannot apply (%#)",
    async (fragment, oldString, newString, replaceAll) => {
      const jwt = await token("mcp-replace-all-errors");
      const response = await request("/api/remember", { fragment }, jwt);
      const item = await response.json<Fragment>();
      const revised = await call(jwt, "revise", {
        new_string: newString,
        old_string: oldString,
        ref: item.ref,
        replaceAll,
      });
      expect(revised.result.isError).toBeTruthy();
      const recalled = await request("/api/recall", { cue: fragment }, jwt);
      const data = await recalled.json<{ recalled: Fragment[] }>();
      expect(
        data.recalled.find((entry) => entry.ref === item.ref)
      ).toMatchObject(item);
    }
  );

  it("keeps REST full replacement separate from MCP edits", async () => {
    const jwt = await token("rest-replace-all");
    const created = await request(
      "/api/remember",
      { fragment: "a old b old c" },
      jwt
    );
    const item = await created.json<Fragment>();
    const input = { new_string: "new", old_string: "old", ref: item.ref };
    const rejected = await request("/api/revise", input, jwt);
    expect(rejected.status).toBe(400);
    await expect(
      call(jwt, "revise", { fragment: "new text", ref: item.ref })
    ).resolves.toMatchObject({ result: { isError: true } });
    const revised = await request(
      "/api/revise",
      { fragment: "Entirely new text", ref: item.ref },
      jwt
    );
    expect(revised.status).toBe(200);
    await expect(revised.json()).resolves.toMatchObject({
      createdAt: item.createdAt,
      fragment: "Entirely new text",
      ref: item.ref,
    });
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
