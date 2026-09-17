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

  const getHistory = (assertion: string, ref: string) =>
    worker.fetch(
      new Request(`https://memsys.test/api/fragments/${ref}/history`, {
        headers: { "Cf-Access-Jwt-Assertion": assertion },
      }),
      bindings
    );

  it("archives forgotten fragments instead of deleting them", async () => {
    const jwt = await token("rest-archive");
    const created = await request(
      "/api/remember",
      { fragment: "Archive me #keep" },
      jwt
    );
    const item = await created.json<Fragment>();
    await request("/api/forget", { ref: item.ref }, jwt);

    const active = await getList(jwt);
    await expect(active.json()).resolves.toStrictEqual({
      fragments: [],
      nextCursor: null,
    });
    const recalled = await request("/api/recall", { cue: "#keep" }, jwt);
    await expect(recalled.json()).resolves.toMatchObject({
      associated: [],
      recalled: [],
    });
    const archived = await getList(jwt, "?archived=1");
    const page = await archived.json<{ fragments: Fragment[] }>();
    expect(page.fragments).toStrictEqual([
      {
        createdAt: item.createdAt,
        fragment: item.fragment,
        ref: item.ref,
        updatedAt: expect.stringMatching(/Z$/u),
        version: 2,
      },
    ]);
    const archivedAt = page.fragments[0]?.updatedAt ?? "";
    expect(archivedAt.localeCompare(item.updatedAt)).toBeGreaterThanOrEqual(0);

    // The archive survives eviction because it is just the latest revision.
    const memory = env.MEMORY.getByName(
      JSON.stringify([issuer, "rest-archive"])
    );
    await evictDurableObject(memory);
    await expect(memory.list({ archived: "true" })).resolves.toStrictEqual({
      fragments: page.fragments,
      nextCursor: null,
    });
  });

  it("records forget and restore as revisions in the history", async () => {
    const jwt = await token("rest-archive-history");
    const created = await request(
      "/api/remember",
      { fragment: "Archive me #keep" },
      jwt
    );
    const item = await created.json<Fragment>();
    await request("/api/forget", { ref: item.ref }, jwt);
    const archived = await getHistory(jwt, item.ref);
    expect(archived.headers.get("Cache-Control")).toBe("no-store");
    await expect(archived.json()).resolves.toStrictEqual({
      ref: item.ref,
      revisions: [
        {
          archived: false,
          createdAt: item.createdAt,
          fragment: item.fragment,
          version: 1,
        },
        {
          archived: true,
          createdAt: expect.stringMatching(/Z$/u),
          fragment: item.fragment,
          version: 2,
        },
      ],
    });

    const restored = await request("/api/restore", { ref: item.ref }, jwt);
    await expect(restored.json()).resolves.toMatchObject({
      createdAt: item.createdAt,
      fragment: item.fragment,
      ref: item.ref,
      version: 3,
    });
    const back = await request("/api/recall", { cue: "#keep" }, jwt);
    await expect(back.json()).resolves.toMatchObject({
      recalled: [{ ref: item.ref, version: 3 }],
    });
    const emptied = await getList(jwt, "?archived=1");
    await expect(emptied.json()).resolves.toStrictEqual({
      fragments: [],
      nextCursor: null,
    });
  });

  it("restores an earlier version as a new revision without rewriting history", async () => {
    const jwt = await token("rest-restore");
    const created = await request(
      "/api/remember",
      { fragment: "First #v1" },
      jwt
    );
    const item = await created.json<Fragment>();
    await request(
      "/api/revise",
      { fragment: "Second #v2", ref: item.ref },
      jwt
    );
    // Restoring the current content of an active fragment writes nothing.
    const same = await request(
      "/api/restore",
      { ref: item.ref, version: 2 },
      jwt
    );
    await expect(same.json()).resolves.toMatchObject({
      fragment: "Second #v2",
      version: 2,
    });
    const reverted = await request(
      "/api/restore",
      { ref: item.ref, version: 1 },
      jwt
    );
    await expect(reverted.json()).resolves.toMatchObject({
      createdAt: item.createdAt,
      fragment: "First #v1",
      version: 3,
    });
    const recalled = await request("/api/recall", { cue: "#v1" }, jwt);
    await expect(recalled.json()).resolves.toMatchObject({
      recalled: [{ fragment: "First #v1", ref: item.ref, version: 3 }],
    });
    const history = await getHistory(jwt, item.ref);
    const { revisions } = await history.json<{
      revisions: { fragment: string; version: number }[];
    }>();
    expect(
      revisions.map(({ fragment, version }) => [version, fragment])
    ).toStrictEqual([
      [1, "First #v1"],
      [2, "Second #v2"],
      [3, "First #v1"],
    ]);
  });

  it("rejects restore targets that do not exist or belong to another identity", async () => {
    const jwt = await token("rest-restore-errors");
    const created = await request(
      "/api/remember",
      { fragment: "Only version" },
      jwt
    );
    const item = await created.json<Fragment>();
    await expect(
      request("/api/restore", { ref: item.ref, version: 9 }, jwt)
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      request("/api/restore", { ref: "2222222" }, jwt)
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      request("/api/restore", { ref: item.ref, version: 0 }, jwt)
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      request("/api/restore", { ref: item.ref }, await token("rest-other"))
    ).resolves.toMatchObject({ status: 404 });
    const recalled = await request("/api/recall", { cue: "Only version" }, jwt);
    await expect(recalled.json()).resolves.toMatchObject({
      recalled: [{ ...item, version: 1 }],
    });
  });

  it("validates history requests", async () => {
    const jwt = await token("rest-history");
    await expect(getHistory(jwt, "invalid!")).resolves.toMatchObject({
      status: 400,
    });
    await expect(getHistory(jwt, "2222222")).resolves.toMatchObject({
      status: 404,
    });
    await expect(getList(jwt, "?archived=maybe")).resolves.toMatchObject({
      status: 400,
    });
  });

  it("migrates original heads without losing distinct timestamps", async () => {
    const memory = env.MEMORY.getByName("migration");
    await runInDurableObject(memory, (_instance, state) => {
      // Rewind storage to the state before the revisions migration.
      state.storage.sql.exec(
        "DELETE FROM __drizzle_migrations WHERE name = '20260917014706_revisions'"
      );
      state.storage.sql.exec("DROP TABLE revisions");
      state.storage.sql.exec("DROP TABLE fragments");
      state.storage.sql.exec(
        "CREATE TABLE fragments (id text PRIMARY KEY, content text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL)"
      );
      state.storage.sql.exec(
        "INSERT INTO fragments VALUES ('abcdefg', 'Legacy #old', 1000, 2000)"
      );
    });
    await evictDurableObject(memory);
    await expect(memory.list({})).resolves.toStrictEqual({
      fragments: [
        {
          createdAt: "1970-01-01T00:00:01.000Z",
          fragment: "Legacy #old",
          ref: "abcdefg",
          updatedAt: "1970-01-01T00:00:02.000Z",
          version: 1,
        },
      ],
      nextCursor: null,
    });
    await runInDurableObject(memory, (_instance, state) => {
      expect([
        ...state.storage.sql.exec("SELECT * FROM revisions"),
      ]).toStrictEqual([
        {
          archived: 0,
          content: "Legacy #old",
          created_at: 2000,
          ref: "abcdefg",
          version: 1,
        },
      ]);
      expect([
        ...state.storage.sql.exec(
          "SELECT archived, content, created_at, ref, updated_at, version FROM fragments"
        ),
      ]).toStrictEqual([
        {
          archived: 0,
          content: "Legacy #old",
          created_at: 1000,
          ref: "abcdefg",
          updated_at: 2000,
          version: 1,
        },
      ]);
    });
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
      const rows = "SELECT * FROM revisions ORDER BY ref, version";
      const before = [...state.storage.sql.exec(rows)];
      instance.recall({ cue: "Durable objects" });
      expect([...state.storage.sql.exec(rows)]).toStrictEqual(before);
      expect([
        ...state.storage.sql.exec(
          "SELECT version, content, archived FROM revisions WHERE ref = ? ORDER BY version",
          neighbor.ref
        ),
      ]).toStrictEqual([
        { archived: 0, content: "Workers #program #other", version: 1 },
        { archived: 0, content: "Workers #changed", version: 2 },
      ]);
    });
    await memory.forget({ ref: seed.ref });
    await evictDurableObject(memory);
    await expect(
      memory.recall({ cue: "Durable objects" })
    ).resolves.toMatchObject({ associated: [], recalled: [] });
  });

  it("rolls back history and the head when the projection write fails", async () => {
    const memory = env.MEMORY.getByName("atomic-projection");
    const item = await memory.remember({ fragment: "Atomic original" });
    await runInDurableObject(memory, (instance, state) => {
      state.storage.sql.exec(
        "CREATE TRIGGER reject_head BEFORE UPDATE ON fragments BEGIN SELECT RAISE(FAIL, 'head rejected'); END"
      );
      expect(() =>
        instance.replace({ fragment: "Partial update", ref: item.ref })
      ).toThrow('insert into "fragments"');
      expect([
        ...state.storage.sql.exec(
          "SELECT content, version FROM revisions WHERE ref = ? ORDER BY version",
          item.ref
        ),
      ]).toStrictEqual([{ content: "Atomic original", version: 1 }]);
      expect([
        ...state.storage.sql.exec(
          "SELECT content, version FROM fragments WHERE ref = ?",
          item.ref
        ),
      ]).toStrictEqual([{ content: "Atomic original", version: 1 }]);
      expect(instance.list({})).toStrictEqual({
        fragments: [item],
        nextCursor: null,
      });
    });
  });

  it("keeps complete history through archive, unarchive, rollback, and eviction", async () => {
    const memory = env.MEMORY.getByName("history-eviction");
    const item = await memory.remember({ fragment: "Version one" });
    await memory.replace({ fragment: "Version two", ref: item.ref });
    await memory.forget({ ref: item.ref });
    await memory.restore({ ref: item.ref });
    await memory.restore({ ref: item.ref, version: 1 });
    await evictDurableObject(memory);

    const history = await memory.history({ ref: item.ref });
    expect(
      history?.revisions.map(({ archived, fragment, version }) => ({
        archived,
        fragment,
        version,
      }))
    ).toStrictEqual([
      { archived: false, fragment: "Version one", version: 1 },
      { archived: false, fragment: "Version two", version: 2 },
      { archived: true, fragment: "Version two", version: 3 },
      { archived: false, fragment: "Version two", version: 4 },
      { archived: false, fragment: "Version one", version: 5 },
    ]);
    await expect(memory.list({})).resolves.toMatchObject({
      fragments: [
        {
          createdAt: item.createdAt,
          fragment: "Version one",
          ref: item.ref,
          version: 5,
        },
      ],
    });
  });

  it("loads cold heads from fragments instead of folding revisions", async () => {
    const memory = env.MEMORY.getByName("head-projection-read");
    const item = await memory.remember({ fragment: "Projected current" });
    await runInDurableObject(memory, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE revisions SET content = 'History sentinel' WHERE ref = ? AND version = 1",
        item.ref
      );
    });
    await evictDurableObject(memory);

    await expect(
      memory.recall({ cue: "Projected current" })
    ).resolves.toMatchObject({
      recalled: [{ fragment: "Projected current", ref: item.ref }],
    });
    await expect(
      memory.recall({ cue: "History sentinel" })
    ).resolves.toMatchObject({ recalled: [] });
  });

  it("does not reuse an archived ref after eviction", async () => {
    const memory = env.MEMORY.getByName("archived-ref-collision");
    const archived = await memory.remember({ fragment: "Archived identity" });
    await memory.forget({ ref: archived.ref });
    await evictDurableObject(memory);

    await runInDurableObject(memory, (instance) => {
      const refs = [archived.ref, "2222222"];
      Reflect.set(instance, "createRef", () => refs.shift() ?? "3333333");
      const created = instance.remember({ fragment: "New identity" });
      expect(created.ref).toBe("2222222");
      expect(instance.list({ archived: "true" })).toMatchObject({
        fragments: [{ ref: archived.ref }],
      });
    });
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
      result: {
        instructions: `Memsys is long-term fragment memory.

Store durable information as small, atomic, self-contained fragments rather than summaries, transcripts, or reasoning traces. Keep fragments concise, around 140 characters when practical, and split independent ideas into separate memories.

Use #anchors for stable entities or concepts that should link related fragments. Fragments with similar anchors are considered as associated and will be returned when recall.

Recall with short textual cues such as distinctive phrases, names, projects, or concepts. Try multiple cues when needed.`,
        serverInfo: { name: "memsys" },
      },
    });
    const list = await request(
      "/mcp",
      { id: 2, jsonrpc: "2.0", method: "tools/list" },
      jwt
    );
    const tools = await list.json<{
      result: {
        tools: {
          description: string;
          name: string;
          inputSchema: { required: string[] };
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
      names: tools.result.tools.map((tool) => tool.name).toSorted(),
      reviseRequired: toolsByName.revise?.inputSchema.required.toSorted(),
    }).toStrictEqual({
      descriptions: {
        forget:
          "Remove a known memory from recall when it is obsolete, incorrect, duplicated, or explicitly requested to be forgotten.",
        recall:
          "Recall memories using a short textual cue. Prefer distinctive phrases, entities, or concepts. Related fragments may also be returned through shared #anchors.",
        remember:
          "Store one durable, independently recallable memory fragment. Keep it atomic, self-contained, and concise. Split multiple ideas into separate fragments. Use #anchors to link related memories.",
        revise:
          "Replace a known memory when its information has changed or needs correction. Keep the replacement atomic and self-contained.",
      },
      names: ["forget", "recall", "remember", "revise"],
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
