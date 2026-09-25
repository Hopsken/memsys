import { env } from "cloudflare:workers";
import type { JSONValue } from "hono/utils/types";
import { describe, expect, it } from "vitest";

import type { Fragment, ImportResult } from "../contract/memory";
import worker from "../worker/index";
import { list, post, useAuth } from "./helpers";
import type { User } from "./helpers";

const exportFile = (user: User) =>
  worker.fetch(
    new Request("https://memsys.test/api/export", {
      headers: { Cookie: user.cookie },
    }),
    env
  );

const file = (fragments: JSONValue[]) => ({
  format: "memsys.fragments",
  fragments,
  version: 1,
});

const remember = async (user: User, fragment: string) => {
  const response = await post("/api/remember", { fragment }, user);
  return response.json<Fragment>();
};

describe("Fragment export and import", () => {
  const signIn = useAuth();

  it("moves every fragment verbatim to another instance", async () => {
    const source = await signIn();
    await remember(source, "First #memsys");
    await remember(source, "Second #memsys");
    const response = await exportFile(source);
    expect(response.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="memsys-\d{4}-\d{2}-\d{2}\.json"$/u
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const exported: JSONValue = JSON.parse(await response.text());

    const target = await signIn();
    const imported = await post("/api/import", exported, target);
    expect(imported.status).toBe(200);
    await expect(imported.json()).resolves.toStrictEqual({
      conflicts: [],
      imported: 2,
      skipped: 0,
    });
    const [before, after] = await Promise.all([list(source), list(target)]);
    expect(after).toStrictEqual(before);
  });

  it("skips what is already there and reports changed refs without touching them", async () => {
    const user = await signIn();
    const kept = await remember(user, "Kept as is");
    const changed = await remember(user, "Local text");
    const same = await remember(user, "Same text elsewhere");
    const response = await post(
      "/api/import",
      file([
        { ...kept },
        { ...changed, fragment: "Imported text" },
        { fragment: same.fragment, ref: "zzzzzzz" },
        { fragment: "New one" },
        { fragment: "New one" },
      ]),
      user
    );
    await expect(response.json<ImportResult>()).resolves.toStrictEqual({
      conflicts: [changed.ref],
      imported: 1,
      skipped: 3,
    });
    const page = await list(user);
    expect(
      page.fragments.map(({ fragment }) => fragment).toSorted()
    ).toStrictEqual([
      "Kept as is",
      "Local text",
      "New one",
      "Same text elsewhere",
    ]);
    const again = await post(
      "/api/import",
      file([{ fragment: "New one" }]),
      user
    );
    await expect(again.json()).resolves.toMatchObject({
      imported: 0,
      skipped: 1,
    });
  });

  it("fills in missing refs and times and keeps given ones", async () => {
    const user = await signIn();
    await post(
      "/api/import",
      file([
        { createdAt: "2024-01-02T03:04:05+08:00", fragment: "Dated" },
        { fragment: "Undated", ref: "abcdefg" },
      ]),
      user
    );
    const { fragments } = await list(user);
    const dated = fragments.find(({ fragment }) => fragment === "Dated");
    expect(dated).toMatchObject({
      createdAt: "2024-01-01T19:04:05.000Z",
      updatedAt: "2024-01-01T19:04:05.000Z",
    });
    expect(dated?.ref).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{7}$/u);
    expect(fragments.find(({ ref }) => ref === "abcdefg")).toMatchObject({
      fragment: "Undated",
    });
  });

  it("bypasses plugin write limits but not the core ceiling", async () => {
    const user = await signIn();
    const long = await post(
      "/api/import",
      file([{ fragment: "x".repeat(800) }]),
      user
    );
    await expect(long.json()).resolves.toMatchObject({ imported: 1 });
    const tooLong = await post(
      "/api/import",
      file([{ fragment: "y".repeat(1001) }]),
      user
    );
    expect(tooLong.status).toBe(422);
  });

  it("stores nothing when any item is invalid and says which", async () => {
    const user = await signIn();
    const cases = [
      [{ fragment: "Fine" }, { fragment: "  " }],
      [{ fragment: "Fine" }, { fragment: "Bad ref", ref: "0000000" }],
      [
        { fragment: "Fine", ref: "abcdefg" },
        { fragment: "Twin", ref: "abcdefg" },
      ],
      [
        {
          createdAt: "2025-02-01T00:00:00Z",
          fragment: "Backwards",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
      [{ fragment: "Fine" }, { content: "Wrong field" }],
    ];
    const responses = await Promise.all(
      cases.map((items) => post("/api/import", file(items), user))
    );
    expect(responses.map(({ status }) => status)).toStrictEqual(
      cases.map(() => 422)
    );
    const body = await responses[1]?.json<{
      issues: { path: string[] }[];
    }>();
    expect(body?.issues[0]?.path).toStrictEqual(["fragments", "1", "ref"]);
    const unknown = await post(
      "/api/import",
      { format: "other", fragments: [], version: 1 },
      user
    );
    expect(unknown.status).toBe(422);
    await expect(list(user)).resolves.toStrictEqual({
      fragments: [],
      nextCursor: null,
    });
  });

  it("accepts a whole memory above the normal request limit", async () => {
    const user = await signIn();
    const items = Array.from({ length: 200 }, (_, index) => ({
      fragment: `Bulk fragment ${index} ${"z".repeat(200)}`,
    }));
    const response = await post("/api/import", file(items), user);
    await expect(response.json()).resolves.toMatchObject({ imported: 200 });
    const huge = await post(
      "/api/import",
      file([{ fragment: "x".repeat(6 * 1024 * 1024) }]),
      user
    );
    expect(huge.status).toBe(413);
  });
});
