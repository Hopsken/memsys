import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { ActivityPage, Fragment } from "../contract/memory";
import worker from "../worker/index";
import { call, content, ORIGIN, post, useAuth } from "./helpers";
import type { User } from "./helpers";

const activity = async (user: User, query = "") => {
  const response = await worker.fetch(
    new Request(`${ORIGIN}/api/activity${query}`, {
      headers: { Cookie: user.cookie },
    }),
    env
  );
  return { body: await response.json<ActivityPage>(), status: response.status };
};

const remember = async (user: User, fragment: string) => {
  const response = await post("/api/remember", { fragment }, user);
  return response.json<Fragment>();
};

describe("Activity", () => {
  const signIn = useAuth();

  it("lists every record newest first, with who wrote it and the text before", async () => {
    const user = await signIn();
    const saved = content<Fragment>(
      await call(user, "remember", { fragment: "Prefers npm" })
    );
    await call(user, "revise", { fragment: "Prefers pnpm", ref: saved.ref });
    const other = await remember(user, "Another");
    await post("/api/forget", { ref: saved.ref }, user);
    const { body } = await activity(user);
    expect(body.nextCursor).toBeNull();
    expect(
      body.entries.map(({ by, fragment, op, previous, ref }) => ({
        by,
        fragment,
        op,
        previous,
        ref,
      }))
    ).toStrictEqual([
      {
        by: "user",
        fragment: null,
        op: "forget",
        previous: "Prefers pnpm",
        ref: saved.ref,
      },
      {
        by: "user",
        fragment: "Another",
        op: "remember",
        previous: null,
        ref: other.ref,
      },
      {
        by: "agent:test",
        fragment: "Prefers pnpm",
        op: "revise",
        previous: "Prefers npm",
        ref: saved.ref,
      },
      {
        by: "agent:test",
        fragment: "Prefers npm",
        op: "remember",
        previous: null,
        ref: saved.ref,
      },
    ]);
  });

  it("pages through records written at the same time without losing any", async () => {
    const user = await signIn();
    // One plain-text import writes every line at the same time.
    const lines = Array.from({ length: 60 }, (_, index) => `Line ${index}`);
    await worker.fetch(
      new Request(`${ORIGIN}/api/import`, {
        body: lines.join("\n"),
        headers: { "Content-Type": "text/plain", Cookie: user.cookie },
        method: "POST",
      }),
      env
    );
    const first = await activity(user);
    expect(first.body.entries).toHaveLength(50);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await activity(
      user,
      `?cursor=${encodeURIComponent(first.body.nextCursor ?? "")}`
    );
    expect(second.body.nextCursor).toBeNull();
    const all = [...first.body.entries, ...second.body.entries];
    expect(new Set(all.map(({ ref }) => ref)).size).toBe(60);
    expect(
      all.map(({ by, fragment, op }) => `${fragment} ${op} ${by}`).toSorted()
    ).toStrictEqual(lines.map((line) => `${line} remember user`).toSorted());
  });

  it("drops a purged fragment and rejects a malformed cursor or a filter", async () => {
    const user = await signIn();
    const kept = await remember(user, "Kept");
    const purged = await remember(user, "Purged");
    await post("/api/purge", { ref: purged.ref }, user);
    await expect(activity(user)).resolves.toMatchObject({
      body: { entries: [{ ref: kept.ref }], nextCursor: null },
    });
    await expect(activity(user, "?cursor=nope")).resolves.toMatchObject({
      status: 400,
    });
    await expect(activity(user, "?tag=memsys")).resolves.toMatchObject({
      status: 400,
    });
  });
});
