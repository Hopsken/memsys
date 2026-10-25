import type { Fragment } from "@core";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import worker from "../worker/index";
import {
  call,
  createInvite,
  getList,
  list,
  ORIGIN,
  post,
  randomIp,
  sentCode,
  useAuth,
  withVersions,
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
    expect(missing.headers.get("WWW-Authenticate")).toContain(
      "resource_metadata="
    );
    await expect(
      tools({ Authorization: "Bearer memsys_forged" })
    ).resolves.toMatchObject({ status: 401 });
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
      fragments: [withVersions(await saved.json<Fragment>())],
      nextCursor: null,
    });
  });

  it("keeps API keys to /mcp and sessions to the web UI", async () => {
    const user = await signIn();
    const asToken = [
      { Authorization: `Bearer ${user.token}` },
      { "x-api-key": user.token },
    ];
    const statuses = await Promise.all(
      asToken.flatMap((headers) => [
        get("/api/fragments", headers),
        get("/api/export", headers),
        post("/api/import", "Injected", null, {
          ...headers,
          "Content-Type": "text/plain",
        }),
        post("/api/purge", { ref: "2222222" }, null, headers),
        get("/api/settings", headers),
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

  it("lists API keys without secrets and revokes them immediately", async () => {
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

  it("gives an API key only the access chosen when it was created", async () => {
    const user = await signIn();
    const create = async (write: boolean) => {
      const response = await post(
        "/api/api-keys",
        { name: write ? "writer" : "reader", write },
        null,
        { Cookie: user.cookie, Origin: ORIGIN }
      );
      expect(response.status).toBe(201);
      return response.json<{ key: string }>();
    };
    const toolNames = async (key: string) => {
      const response = await tools({ Authorization: `Bearer ${key}` });
      const { result } = await response.json<{
        result: { tools: { name: string }[] };
      }>();
      return result.tools.map(({ name }) => name).toSorted();
    };
    const reader = await create(false);
    const writer = await create(true);
    const legacy = await createToken(user, "legacy");
    const listed = await get("/api/auth/api-key/list", { Cookie: user.cookie });
    const { apiKeys } = await listed.json<{
      apiKeys: { name: string; permissions: unknown }[];
    }>();

    await env.DB.prepare('UPDATE "apikey" SET "permissions" = ? WHERE "id" = ?')
      .bind(JSON.stringify({ memory: ["write"] }), legacy.id)
      .run();
    const writeOnly = await tools({ Authorization: `Bearer ${legacy.key}` });

    expect({
      legacy: await toolNames(user.token),
      listed: Object.fromEntries(
        apiKeys.map(({ name, permissions }) => [name, permissions])
      ),
      reader: await toolNames(reader.key),
      writeOnly: writeOnly.status,
      writer: await toolNames(writer.key),
    }).toStrictEqual({
      legacy: ["forget", "list_tags", "recall", "remember", "revise"],
      listed: {
        legacy: null,
        reader: { memory: ["read"] },
        test: null,
        writer: { memory: ["read", "write"] },
      },
      reader: ["list_tags", "recall"],
      writeOnly: 403,
      writer: ["forget", "list_tags", "recall", "remember", "revise"],
    });
    await expect(
      post("/api/api-keys", { name: "x", write: true }, null, {
        Authorization: `Bearer ${writer.key}`,
        Origin: ORIGIN,
      })
    ).resolves.toMatchObject({ status: 401 });
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
    const found = await post("/api/recall", { cues: "Private" }, bob);
    await expect(found.json()).resolves.toStrictEqual({
      fragments: [],
      truncated: false,
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
      fragments: [withVersions(item)],
      nextCursor: null,
    });
  });
});

const requestCode = (email: string, invite: { inviteCode?: string } = {}) =>
  post(
    "/api/auth/email-otp/send-verification-otp",
    {
      email,
      type: "sign-in",
      ...invite,
    },
    null,
    { "cf-connecting-ip": randomIp() }
  );

const signInWithCode = (email: string, inviteCode: string) =>
  post(
    "/api/auth/sign-in/email-otp",
    { email, inviteCode, otp: sentCode(email) ?? "" },
    null,
    { "cf-connecting-ip": randomIp() }
  );

const accountExists = async (email: string) =>
  (await env.DB.prepare('SELECT 1 FROM "user" WHERE "email" = ?')
    .bind(email)
    .first()) !== null;

const usesOf = (code: string) =>
  env.DB.prepare('SELECT "uses" FROM "inviteCode" WHERE "code" = ?')
    .bind(code)
    .first<number>("uses");

const newEmail = () => `${crypto.randomUUID()}@memsys.test`;

describe("Invite codes", () => {
  const signIn = useAuth();

  it("sends no code to a new address without an invite and creates no account", async () => {
    const email = newEmail();
    const sent = await requestCode(email);
    const signedIn = await post(
      "/api/auth/sign-in/email-otp",
      { email, otp: "000000" },
      null
    );
    expect({
      code: sentCode(email),
      error: await sent.json(),
      exists: await accountExists(email),
      signedIn: signedIn.ok,
    }).toStrictEqual({
      code: undefined,
      error: expect.objectContaining({ code: "NO_ACCOUNT" }),
      exists: false,
      signedIn: false,
    });
  });

  it("lets an invite create as many accounts as it has uses, and existing users sign in without using it", async () => {
    const invite = await createInvite({ maxUses: 2 });
    const first = await signIn(newEmail(), invite);
    await signIn(first.email, invite);
    await signIn(
      newEmail(),
      `${invite.slice(0, 4)}-${invite.slice(4)}`.toLowerCase()
    );
    const third = newEmail();
    const refused = await requestCode(third, { inviteCode: invite });
    expect({
      code: sentCode(third),
      error: await refused.json(),
      uses: await usesOf(invite),
    }).toStrictEqual({
      code: undefined,
      error: expect.objectContaining({ code: "INVITE_CODE_UNUSABLE" }),
      uses: 2,
    });
  });

  it("refuses an expired invite", async () => {
    const invite = await createInvite({ expiresAt: Date.now() - 1 });
    const email = newEmail();
    const refused = await requestCode(email, { inviteCode: invite });
    expect(refused.status).toBe(403);
    expect(sentCode(email)).toBeUndefined();
  });

  it("creates no account when the invite runs out after the code was sent", async () => {
    const invite = await createInvite();
    const [winner, loser] = [newEmail(), newEmail()];
    await requestCode(winner, { inviteCode: invite });
    await requestCode(loser, { inviteCode: invite });
    const won = await signInWithCode(winner, invite);
    const lost = await signInWithCode(loser, invite);
    expect({
      loserExists: await accountExists(loser),
      lost: lost.status,
      won: won.status,
    }).toStrictEqual({ loserExists: false, lost: 403, won: 200 });
  });

  it("tells the join page whether an invite still works", async () => {
    const usable = await createInvite();
    const usedUp = await createInvite({ maxUses: 1 });
    await signIn(newEmail(), usedUp);
    const expired = await createInvite({ expiresAt: Date.now() - 1 });
    const check = async (code: string) => {
      const response = await get(
        `/api/auth/invite-code/check?code=${encodeURIComponent(code)}`
      );
      const { usable: isUsable } = await response.json<{ usable: boolean }>();
      return isUsable;
    };
    expect({
      dashedLowercase: await check(
        `${usable.slice(0, 4)}-${usable.slice(4)}`.toLowerCase()
      ),
      expired: await check(expired),
      unknown: await check("ZZZZ-ZZZZ"),
      usedUp: await check(usedUp),
    }).toStrictEqual({
      dashedLowercase: true,
      expired: false,
      unknown: false,
      usedUp: false,
    });
  });
});
