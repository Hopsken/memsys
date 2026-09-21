import { env } from "cloudflare:workers";
import { generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";

import worker from "../worker/index";
import type { Fragment } from "../worker/memory";
import { call, getList, list, post, useAccess } from "./helpers";

describe("Access identity", () => {
  const token = useAccess();

  it("fails closed without configuration or a verified assertion", async () => {
    await expect(
      worker.fetch(new Request("https://memsys.test/api/fragments"), {
        ...env,
        ACCESS_AUD: "",
        ACCESS_ISSUER: "",
      })
    ).resolves.toMatchObject({ status: 503 });
    await expect(
      post("/api/remember", { fragment: "secret" }, "", {
        Authorization: "Bearer opaque-oauth-token",
        "Cf-Access-Authenticated-User-Email": "spoof@example.com",
      })
    ).resolves.toMatchObject({ status: 401 });
    await expect(getList("")).resolves.toMatchObject({ status: 401 });
    await expect(post("/mcp", {}, "forged")).resolves.toMatchObject({
      status: 401,
    });
  });

  it.each([
    { aud: "other" },
    { iss: "https://other.cloudflareaccess.com" },
    { exp: 1 },
    { sub: "" },
    { sub: 42 },
    { sub: undefined },
    { type: "org" },
    { nbf: 9_999_999_999 },
  ])("rejects invalid signed identity claims: %j", async (claims) => {
    await expect(
      post("/api/recall", { cue: "secret" }, await token("alice", claims))
    ).resolves.toMatchObject({ status: 401 });
  });

  it("rejects a valid-looking token signed by another key", async () => {
    const other = await generateKeyPair("RS256");
    await expect(
      post(
        "/api/recall",
        { cue: "secret" },
        await token("alice", {}, other.privateKey)
      )
    ).resolves.toMatchObject({ status: 401 });
  });

  it("isolates reads, edits, and deletion across REST and MCP identities", async () => {
    const alice = await token("owner");
    const bob = await token("other-user");
    const saved = await post(
      "/api/remember",
      { fragment: "Private design #private" },
      alice
    );
    const item = await saved.json<Fragment>();
    const found = await post("/api/recall", { cue: "Private" }, bob);
    await expect(found.json()).resolves.toMatchObject({
      associated: [],
      recalled: [],
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
      call(bob, "revise", {
        new_string: "stolen",
        old_string: "Private",
        ref: item.ref,
      })
    ).resolves.toMatchObject({ isError: true });
    await expect(list(alice)).resolves.toStrictEqual({
      fragments: [item],
      nextCursor: null,
    });
  });
});
