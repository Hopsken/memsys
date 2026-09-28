import { env } from "cloudflare:workers";
import type { JSONValue } from "hono/utils/types";
import { describe, expect, it } from "vitest";

import type { Fragment, FragmentPage } from "../contract/memory";
import worker from "../worker/index";
import {
  getList,
  list,
  memoryOf,
  post,
  useAuth,
  withoutJev,
  withVersions,
} from "./helpers";

describe("Fragment HTTP API", () => {
  const signIn = useAuth();

  it("creates and replaces text while preserving identity", async () => {
    const user = await signIn();
    await withoutJev(memoryOf(user));
    const saved = await post("/api/remember", { fragment: "Original" }, user);
    expect(saved.status).toBe(201);
    const item = await saved.json<Fragment>();
    const revised = await post(
      "/api/revise",
      { fragment: "Changed design #project/b", ref: item.ref },
      user
    );
    expect(revised.status).toBe(200);
    const next = await revised.json<Fragment>();
    expect(next).toMatchObject({
      fragment: "Changed design #project/b",
      ref: item.ref,
    });
    expect(Date.parse(next.at)).toBeGreaterThan(Date.parse(item.at));
    const found = await post("/api/recall", { cue: "changed design" }, user);
    await expect(found.json()).resolves.toMatchObject({
      fragments: [{ fragment: "Changed design #project/b", ref: item.ref }],
      hasMore: false,
    });
  });

  it("deletes a fragment and reports missing refs", async () => {
    const user = await signIn();
    const saved = await post(
      "/api/remember",
      { fragment: "Delete this" },
      user
    );
    const { ref } = await saved.json<Fragment>();
    const deleted = await post("/api/forget", { ref }, user);
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toStrictEqual({ ref });
    await expect(post("/api/forget", { ref }, user)).resolves.toMatchObject({
      status: 404,
    });
    await expect(
      post("/api/revise", { fragment: "Gone", ref }, user)
    ).resolves.toMatchObject({ status: 404 });
    await expect(list(user)).resolves.toStrictEqual({
      fragments: [],
      nextCursor: null,
    });
  });

  it("purges every version of a fragment, forgotten or not", async () => {
    const user = await signIn();
    const saved = await post("/api/remember", { fragment: "Secret" }, user);
    const { ref } = await saved.json<Fragment>();
    await post("/api/revise", { fragment: "Secret, revised", ref }, user);
    const other = await post("/api/remember", { fragment: "Forgotten" }, user);
    const forgotten = await other.json<Fragment>();
    await post("/api/forget", { ref: forgotten.ref }, user);
    const purged = await Promise.all(
      [ref, forgotten.ref].map(async (target) => {
        const response = await post("/api/purge", { ref: target }, user);
        return response.json();
      })
    );
    expect(purged).toStrictEqual([{ ref }, { ref: forgotten.ref }]);
    await expect(post("/api/purge", { ref }, user)).resolves.toMatchObject({
      status: 404,
    });
    await expect(list(user)).resolves.toStrictEqual({
      fragments: [],
      nextCursor: null,
    });
    const history = await worker.fetch(
      new Request("https://memsys.test/api/export?history=true", {
        headers: { Cookie: user.cookie },
      }),
      env
    );
    expect(new TextDecoder().decode(await history.arrayBuffer())).toBe("");
  });

  it("follows the returned page cursor without caching or changing fragments", async () => {
    const user = await signIn();
    const saved = await Promise.all(
      Array.from({ length: 51 }, async (_, index) => {
        const response = await post(
          "/api/remember",
          { fragment: `Page item ${index}` },
          user
        );
        return response.json<Fragment>();
      })
    );
    const response = await getList(user);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const first = await response.json<FragmentPage>();
    expect(first.fragments).toHaveLength(50);
    const next = await getList(
      user,
      `?${new URLSearchParams({ cursor: first.nextCursor ?? "" })}`
    );
    const last = await next.json<FragmentPage>();
    expect(last.nextCursor).toBeNull();
    expect(
      [...first.fragments, ...last.fragments].toSorted((a, b) =>
        a.ref.localeCompare(b.ref)
      )
    ).toStrictEqual(
      saved
        .toSorted((a, b) => a.ref.localeCompare(b.ref))
        .map((item) => withVersions(item))
    );
  });

  it("filters the list by every repeated tag", async () => {
    const user = await signIn();
    await Promise.all(
      ["Only #a", "Both #a #b/c", "Other #b"].map((fragment) =>
        post("/api/remember", { fragment }, user)
      )
    );
    const response = await getList(user, "?tag=a&tag=b");
    const page = await response.json<FragmentPage>();
    expect(page.fragments.map(({ fragment }) => fragment)).toStrictEqual([
      "Both #a #b/c",
    ]);
  });

  it.each([
    "?cursor=",
    "?tag=",
    "?tag=%23a",
    "?tag=a%20b",
    "?cursor=invalid",
    "?cursor=2026-02-30T00:00:00.000Z,aaaaaaa",
    "?cursor=2026-01-01T00:00:00.000Z,invalid",
    "?cursor=2026-01-01T00:00:00.000Z,aaaaaaa,extra",
    "?space=other",
  ])("rejects invalid list query %s", async (query) => {
    await expect(getList(await signIn(), query)).resolves.toMatchObject({
      status: 400,
    });
  });

  it.each([
    ["/api/remember", { fragment: " \n " }, 400],
    ["/api/remember", { fragment: 12 }, 400],
    ["/api/remember", { fragment: "x".repeat(33_000) }, 413],
    ["/api/remember", { fragment: "x", space: "another-user" }, 400],
    ["/api/revise", { fragment: "", ref: "7x9c2pa" }, 400],
    ["/api/recall", { cue: " " }, 400],
    ["/api/recall", { cue: "x", limit: 10 }, 400],
    ["/api/forget", { ref: "invalid!" }, 400],
  ] satisfies [string, JSONValue, number][])(
    "rejects invalid request %#",
    async (path, body, status) => {
      await expect(post(path, body, await signIn())).resolves.toMatchObject({
        status,
      });
    }
  );

  it("rejects malformed JSON", async () => {
    const user = await signIn();
    await expect(
      worker.fetch(
        new Request("https://memsys.test/api/remember", {
          body: "{",
          headers: {
            "Content-Type": "application/json",
            Cookie: user.cookie,
          },
          method: "POST",
        }),
        env
      )
    ).resolves.toMatchObject({ status: 400 });
  });
});
