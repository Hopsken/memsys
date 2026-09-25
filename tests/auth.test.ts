import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { Fragment } from "../contract/memory";
import worker from "../worker/index";
import {
  call,
  getList,
  list,
  ORIGIN,
  post,
  sentCode,
  useAuth,
} from "./helpers";
import type { User } from "./helpers";

const get = (path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`${ORIGIN}${path}`, { headers }), env);

const tools = (headers: Record<string, string>) =>
  post("/mcp", { id: 1, jsonrpc: "2.0", method: "tools/list" }, null, headers);

const createToken = async (user: User, name: string) => {
  const response = await post("/api/auth/api-key/create", { name }, null, {
    Cookie: user.cookie,
    Origin: ORIGIN,
  });
  return response.json<{ id: string; key: string }>();
};

describe("Authentication", () => {
  const signIn = useAuth();

  it("fails closed without a session or token", async () => {
    await expect(getList(null)).resolves.toMatchObject({ status: 401 });
    await expect(
      get("/api/fragments", { Cookie: "better-auth.session_token=forged" })
    ).resolves.toMatchObject({ status: 401 });
    const missing = await tools({});
    expect(missing.status).toBe(401);
    expect(missing.headers.get("WWW-Authenticate")).toBe(
      'Bearer realm="memsys"'
    );
    await expect(
      tools({ Authorization: "Bearer memsys_forged" })
    ).resolves.toMatchObject({ status: 401 });
  });

  it("sends codes only to allowed addresses and never creates other users", async () => {
    const email = `${crypto.randomUUID()}@elsewhere.test`;
    const sent = await post(
      "/api/auth/email-otp/send-verification-otp",
      { email, type: "sign-in" },
      null
    );
    const signedIn = await post(
      "/api/auth/sign-in/email-otp",
      { email, otp: "000000" },
      null
    );
    const row = await env.DB.prepare('SELECT 1 FROM "user" WHERE "email" = ?')
      .bind(email)
      .first();
    expect({
      code: sentCode(email),
      row,
      sent: sent.status,
      signedIn: signedIn.ok,
    }).toStrictEqual({
      code: undefined,
      row: null,
      sent: 200,
      signedIn: false,
    });
  });

  it("rejects a wrong code and signs the same address into the same memory", async () => {
    const user = await signIn();
    await post(
      "/api/auth/email-otp/send-verification-otp",
      { email: user.email, type: "sign-in" },
      null
    );
    const wrong = String((Number(sentCode(user.email)) + 1) % 1_000_000);
    const rejected = await post(
      "/api/auth/sign-in/email-otp",
      { email: user.email, otp: wrong.padStart(6, "0") },
      null
    );
    expect(rejected.ok).toBeFalsy();
    const saved = await post("/api/remember", { fragment: "Stable" }, user);
    const again = await signIn(user.email);
    expect(again.id).toBe(user.id);
    await expect(list(again)).resolves.toStrictEqual({
      fragments: [await saved.json<Fragment>()],
      nextCursor: null,
    });
  });

  it("keeps MCP tokens to /mcp and sessions to the web UI", async () => {
    const user = await signIn();
    const asToken = [
      { Authorization: `Bearer ${user.token}` },
      { "x-api-key": user.token },
    ];
    const statuses = await Promise.all(
      asToken.flatMap((headers) => [
        get("/api/fragments", headers),
        get("/api/export", headers),
        post(
          "/api/import",
          {
            format: "memsys.fragments",
            fragments: [{ fragment: "Injected" }],
            version: 1,
          },
          null,
          headers
        ),
        get("/api/plugins", headers),
        post(
          "/api/plugins/size-limit",
          { config: {}, enabled: false, updatedAt: null },
          null,
          headers
        ),
        get("/api/auth/api-key/list", headers),
        post("/api/auth/api-key/create", { name: "escalate" }, null, {
          ...headers,
          Origin: ORIGIN,
        }),
      ])
    ).then((responses) => responses.map((response) => response.status));
    expect(statuses.every((status) => status === 401)).toBeTruthy();
    await expect(tools({ Cookie: user.cookie })).resolves.toMatchObject({
      status: 401,
    });
  });

  it("lists tokens without secrets and revokes them immediately", async () => {
    const user = await signIn();
    const extra = await createToken(user, "laptop");
    const bearer = async (key: string) => {
      const response = await tools({ Authorization: `Bearer ${key}` });
      return response.status;
    };
    const before = await bearer(extra.key);
    const listed = await get("/api/auth/api-key/list", { Cookie: user.cookie });
    const body = JSON.stringify(await listed.json());
    const revoked = await post(
      "/api/auth/api-key/delete",
      { keyId: extra.id },
      null,
      { Cookie: user.cookie, Origin: ORIGIN }
    );
    expect({
      after: await bearer(extra.key),
      before,
      other: await bearer(user.token),
      revoked: revoked.status,
      shown: [body.includes(extra.key), body.includes(extra.key.slice(0, 11))],
    }).toStrictEqual({
      after: 401,
      before: 200,
      other: 200,
      revoked: 200,
      shown: [false, true],
    });
  });

  it("does not let one user revoke another user's token", async () => {
    const alice = await signIn();
    const bob = await signIn();
    const token = await createToken(alice, "alice");
    await post("/api/auth/api-key/delete", { keyId: token.id }, null, {
      Cookie: bob.cookie,
      Origin: ORIGIN,
    });
    await expect(
      tools({ Authorization: `Bearer ${token.key}` })
    ).resolves.toMatchObject({ status: 200 });
  });

  it("isolates reads, edits, and deletion across REST and MCP identities", async () => {
    const alice = await signIn();
    const bob = await signIn();
    const saved = await post(
      "/api/remember",
      { fragment: "Private design #private" },
      alice
    );
    const item = await saved.json<Fragment>();
    const found = await post("/api/recall", { cue: "Private" }, bob);
    await expect(found.json()).resolves.toStrictEqual({
      fragments: [],
      hasMore: false,
    });
    await expect(list(bob)).resolves.toStrictEqual({
      fragments: [],
      nextCursor: null,
    });
    const results = await Promise.all([
      post("/api/revise", { fragment: "stolen", ref: item.ref }, bob),
      post("/api/forget", { ref: item.ref }, bob),
    ]);
    expect(results.map((result) => result.status)).toStrictEqual([404, 404]);
    await expect(
      call(bob, "revise", { fragment: "stolen", ref: item.ref })
    ).resolves.toMatchObject({ isError: true });
    await expect(list(alice)).resolves.toStrictEqual({
      fragments: [item],
      nextCursor: null,
    });
  });
});
