import type { ForgottenList, Fragment, History, Restored } from "@core";
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import worker from "../worker/index";
import { list, memoryOf, ORIGIN, post, useAuth } from "./helpers";
import type { User } from "./helpers";

const get = async <T>(user: User, path: string) => {
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, { headers: { Cookie: user.cookie } }),
    env
  );
  return { body: await response.json<T>(), status: response.status };
};

const history = async (user: User, ref: string) => {
  const { body } = await get<History>(user, `/api/fragments/${ref}/history`);
  return body.versions;
};

const remember = async (user: User, fragment: string) => {
  const response = await post("/api/remember", { fragment }, user);
  return response.json<Fragment>();
};

const restore = async (user: User, ref: string, id: number) => {
  const response = await post(`/api/fragments/${ref}/restore`, { id }, user);
  return response.json<Restored>();
};

describe("History and restore", () => {
  const signIn = useAuth();

  it("lists every version newest first and counts them in the list", async () => {
    const user = await signIn();
    const saved = await remember(user, "First");
    const revised = await post(
      "/api/revise",
      { fragment: "Second", ref: saved.ref },
      user
    );
    const second = await revised.json<Fragment>();
    await post("/api/forget", { ref: saved.ref }, user);
    const versions = await history(user, saved.ref);
    expect(versions.slice(1)).toStrictEqual([
      {
        createdAt: second.updatedAt,
        fragment: "Second",
        id: second.versionId,
        op: "revise",
        ref: saved.ref,
        source: "user",
      },
      {
        createdAt: saved.updatedAt,
        fragment: "First",
        id: saved.versionId,
        op: "remember",
        ref: saved.ref,
        source: "user",
      },
    ]);
    expect(versions[0]).toMatchObject({
      fragment: null,
      op: "forget",
      ref: saved.ref,
      source: "user",
    });
    expect(versions[0]?.id ?? 0).toBeGreaterThan(second.versionId);
    await expect(
      get(user, "/api/fragments/2222222/history")
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      get(user, "/api/fragments/invalid!/history")
    ).resolves.toMatchObject({ status: 400 });
  });

  it("restores an earlier version under the same ref, keeping the one it replaces", async () => {
    const user = await signIn();
    const saved = await remember(user, "Original");
    await post("/api/revise", { fragment: "Mistake", ref: saved.ref }, user);
    const restored = await restore(user, saved.ref, saved.versionId);
    expect(restored).toMatchObject({
      fragment: {
        createdAt: saved.createdAt,
        fragment: "Original",
        ref: saved.ref,
        source: "user",
      },
      version: { op: "revise", ref: saved.ref, source: "user" },
      versions: 3,
    });
    expect(restored.version.id).toBe(restored.fragment?.versionId);
    await expect(list(user)).resolves.toStrictEqual({
      fragments: [
        {
          createdAt: saved.createdAt,
          fragment: "Original",
          ref: saved.ref,
          source: "user",
          updatedAt: restored.version.createdAt,
          versionId: restored.version.id,
          versions: 3,
        },
      ],
      nextCursor: null,
    });
    const versions = await history(user, saved.ref);
    expect(versions.map(({ fragment, op }) => [fragment, op])).toStrictEqual([
      ["Original", "revise"],
      ["Mistake", "revise"],
      ["Original", "remember"],
    ]);
  });

  it("brings back a forgotten fragment and forgets by restoring a forget", async () => {
    const user = await signIn();
    const saved = await remember(user, "Keep this #memsys");
    await post("/api/forget", { ref: saved.ref }, user);
    await expect(list(user)).resolves.toMatchObject({ fragments: [] });
    await expect(
      restore(user, saved.ref, saved.versionId)
    ).resolves.toMatchObject({
      version: { op: "restore", source: "user" },
    });
    await expect(list(user)).resolves.toMatchObject({
      fragments: [{ fragment: "Keep this #memsys", ref: saved.ref }],
    });
    const versions = await history(user, saved.ref);
    const forget = versions.find(({ op }) => op === "forget");
    if (forget === undefined) {
      throw new Error("A forget should be in the history");
    }
    await expect(restore(user, saved.ref, forget.id)).resolves.toMatchObject({
      fragment: null,
      version: {
        fragment: null,
        op: "forget",
        ref: saved.ref,
        source: "user",
      },
      versions: 4,
    });
    await expect(list(user)).resolves.toMatchObject({ fragments: [] });
  });

  it.each([
    ["2222222", { id: 1 }, 404],
    ["2222222", { id: "1" }, 400],
    ["2222222", { id: 0 }, 400],
    ["invalid!", { id: 1 }, 400],
    ["2222222", {}, 400],
    ["2222222", { id: 1, ref: "2222222" }, 400],
  ])("rejects restoring %s %o", async (ref, body, status) => {
    await expect(
      post(`/api/fragments/${ref}/restore`, body, await signIn())
    ).resolves.toMatchObject({ status });
  });

  it("lists forgotten fragments with their last text, newest forgotten first", async () => {
    const user = await signIn();
    const live = await remember(user, "Still here");
    const older = await remember(user, "Old text");
    const revised = await post(
      "/api/revise",
      { fragment: "Last text", ref: older.ref },
      user
    );
    const last = await revised.json<Fragment>();
    const newer = await remember(user, "Newer");
    const purged = await remember(user, "Purged");
    await Promise.all(
      [older.ref, newer.ref, purged.ref].map((ref) =>
        post("/api/forget", { ref }, user)
      )
    );
    await post("/api/purge", { ref: purged.ref }, user);
    const { body } = await get<ForgottenList>(user, "/api/fragments/forgotten");
    expect(body.fragments.map(({ ref }) => ref)).toStrictEqual(
      [older.ref, newer.ref].toSorted((a, b) => {
        const at = (ref: string) =>
          body.fragments.find((item) => item.ref === ref)?.forgottenAt ?? "";
        return at(b).localeCompare(at(a)) || a.localeCompare(b);
      })
    );
    const old = body.fragments.find(({ ref }) => ref === older.ref);
    expect(old).toMatchObject({
      createdAt: older.createdAt,
      fragment: "Last text",
      updatedAt: last.updatedAt,
      versionId: last.versionId,
    });
    expect(Date.parse(old?.forgottenAt ?? "")).toBeGreaterThanOrEqual(
      Date.parse(last.updatedAt)
    );
    expect(body.fragments.some(({ ref }) => ref === live.ref)).toBeFalsy();
  });

  it("keeps version counts across a restart", async () => {
    const user = await signIn();
    const saved = await remember(user, "Counted");
    await post(
      "/api/revise",
      { fragment: "Counted, v2", ref: saved.ref },
      user
    );
    await evictDurableObject(memoryOf(user));
    await expect(list(user)).resolves.toMatchObject({
      fragments: [{ ref: saved.ref, versions: 2 }],
    });
  });
});
