import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { Fragment, ImportResult, LogRecord } from "../contract/memory";
import worker from "../worker/index";
import { list, memoryOf, ORIGIN, post, useAuth } from "./helpers";
import type { User } from "./helpers";

const exportFile = (user: User, query = "") =>
  worker.fetch(
    new Request(`${ORIGIN}/api/export${query}`, {
      headers: { Cookie: user.cookie },
    }),
    env
  );

// Decoded directly: workerd warns when .text() reads a non-text type.
const read = async (response: Response) =>
  new TextDecoder().decode(await response.arrayBuffer());

const records = async (user: User, query = "") => {
  const text = await read(await exportFile(user, query));
  return text
    .split("\n")
    .filter(Boolean)
    .map((line): LogRecord => JSON.parse(line));
};

const importFile = (
  user: User,
  content: string,
  type = "application/x-ndjson"
) =>
  worker.fetch(
    new Request(`${ORIGIN}/api/import`, {
      body: content,
      headers: { "Content-Type": type, Cookie: user.cookie },
      method: "POST",
    }),
    env
  );

const log = (items: Omit<LogRecord, "v">[]) =>
  items.map((item) => `${JSON.stringify({ v: 1, ...item })}\n`).join("");

const remember = async (user: User, fragment: string) => {
  const response = await post("/api/remember", { fragment }, user);
  return response.json<Fragment>();
};

const texts = async (user: User) => {
  const { fragments } = await list(user);
  return fragments.map(({ fragment }) => fragment).toSorted();
};

describe("Fragment export and import", () => {
  const signIn = useAuth();

  it("moves current fragments verbatim to another instance", async () => {
    const source = await signIn();
    await remember(source, "First #memsys");
    const second = await remember(source, "Second #memsys");
    await post(
      "/api/revise",
      { fragment: "Second, revised", ref: second.ref },
      source
    );
    const gone = await remember(source, "Forgotten");
    await post("/api/forget", { ref: gone.ref }, source);
    const response = await exportFile(source);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "cache-control": "no-store",
      "content-disposition": expect.stringMatching(
        /^attachment; filename="memsys-\d{4}-\d{2}-\d{2}\.ndjson"$/u
      ),
      "content-type": "application/x-ndjson; charset=utf-8",
    });
    const file = await read(response);
    expect(file.split("\n")).toHaveLength(3);

    const target = await signIn();
    const imported = await importFile(target, file);
    expect(imported.status).toBe(200);
    await expect(imported.json()).resolves.toStrictEqual({
      conflicts: [],
      imported: 2,
      skipped: 0,
    });
    const [before, after] = await Promise.all([list(source), list(target)]);
    // Current fragments only: each arrives as a single version.
    expect(after).toStrictEqual({
      ...before,
      fragments: before.fragments.map((item) => ({ ...item, versions: 1 })),
    });
  });

  it("moves the whole history, forgotten fragments included", async () => {
    const source = await signIn();
    const item = await remember(source, "Before");
    await post("/api/revise", { fragment: "After", ref: item.ref }, source);
    const gone = await remember(source, "Forgotten");
    await post("/api/forget", { ref: gone.ref }, source);
    const response = await exportFile(source, "?history=true");
    expect(response.headers.get("Content-Disposition")).toMatch(
      /filename="memsys-\d{4}-\d{2}-\d{2}-history\.ndjson"$/u
    );
    const history = await records(source, "?history=true");
    expect(
      history.map(({ by, fragment, op }) => [fragment, op, by])
    ).toStrictEqual([
      ["Before", "remember", "user"],
      ["After", "revise", "user"],
      ["Forgotten", "remember", "user"],
      [null, "forget", "user"],
    ]);

    const target = await signIn();
    const imported = await importFile(target, await read(response));
    await expect(imported.json()).resolves.toStrictEqual({
      conflicts: [],
      imported: 1,
      skipped: 0,
    });
    await expect(list(target)).resolves.toStrictEqual(await list(source));
    await expect(records(target, "?history=true")).resolves.toStrictEqual(
      history
    );
  });

  it("never changes a ref it knows, even a forgotten one", async () => {
    const user = await signIn();
    const kept = await remember(user, "Kept as is");
    const changed = await remember(user, "Local text");
    const same = await remember(user, "Same text elsewhere");
    const forgotten = await remember(user, "Forgotten here");
    await post("/api/forget", { ref: forgotten.ref }, user);
    const at = "2020-01-01T00:00:00.000Z";
    const response = await importFile(
      user,
      log([
        { at, fragment: kept.fragment, ref: kept.ref },
        { at, fragment: "Imported text", ref: changed.ref },
        { at, fragment: forgotten.fragment, ref: forgotten.ref },
        { at, fragment: same.fragment, ref: "zzzzzzz" },
        { at, fragment: "New one", ref: "yyyyyyy" },
      ])
    );
    await expect(response.json<ImportResult>()).resolves.toStrictEqual({
      conflicts: [changed.ref, forgotten.ref],
      imported: 1,
      skipped: 2,
    });
    await expect(texts(user)).resolves.toStrictEqual([
      "Kept as is",
      "Local text",
      "New one",
      "Same text elsewhere",
    ]);
    // A known ref stays known after the object restarts.
    await evictDurableObject(memoryOf(user));
    const again = await importFile(
      user,
      log([{ at, fragment: "Back", ref: forgotten.ref }])
    );
    await expect(again.json()).resolves.toMatchObject({
      conflicts: [forgotten.ref],
    });
  });

  it("imports plain text as new fragments, one per line", async () => {
    const user = await signIn();
    await remember(user, "Already here");
    const response = await importFile(
      user,
      "One #memsys\r\n\nAlready here\nTwo\nOne #memsys\n",
      "text/plain; charset=utf-8"
    );
    await expect(response.json()).resolves.toStrictEqual({
      conflicts: [],
      imported: 2,
      skipped: 2,
    });
    await expect(texts(user)).resolves.toStrictEqual([
      "Already here",
      "One #memsys",
      "Two",
    ]);
  });

  it("bypasses plugin write limits but not the core ceiling", async () => {
    const user = await signIn();
    const long = await importFile(user, "x".repeat(800), "text/plain");
    await expect(long.json()).resolves.toMatchObject({ imported: 1 });
    const tooLong = await importFile(user, "y".repeat(1001), "text/plain");
    expect(tooLong.status).toBe(422);
  });

  it("stores nothing when any line is invalid and says which", async () => {
    const user = await signIn();
    const valid = log([
      { at: "2020-01-01T00:00:00.000Z", fragment: "Fine", ref: "abcdefg" },
    ]);
    const cases = [
      `${valid}not json\n`,
      `${valid}{"v":2,"ref":"hjkmnpq","fragment":"Later","at":"2020-01-01T00:00:00.000Z"}\n`,
      `${valid}${valid}`,
      `${valid}\n`,
    ];
    const responses = await Promise.all(
      cases.map((content) => importFile(user, content))
    );
    expect(responses.map(({ status }) => status)).toStrictEqual(
      cases.map(() => 422)
    );
    const body = await responses[1]?.json<{
      error: string;
      issues: { path: string[] }[];
    }>();
    expect(body?.issues[0]?.path).toStrictEqual(["2", "v"]);
    expect(body?.error).toMatch(/^Line 2, v: /u);
    const json = await post("/api/import", { fragments: [] }, user);
    expect(json.status).toBe(415);
    await expect(list(user)).resolves.toStrictEqual({
      fragments: [],
      nextCursor: null,
    });
  });

  it("accepts a whole memory above the normal request limit", async () => {
    const user = await signIn();
    const lines = Array.from(
      { length: 200 },
      (_, index) => `Bulk fragment ${index} ${"z".repeat(200)}`
    );
    const response = await importFile(user, lines.join("\n"), "text/plain");
    await expect(response.json()).resolves.toMatchObject({ imported: 200 });
    const huge = await importFile(
      user,
      "x".repeat(11 * 1024 * 1024),
      "text/plain"
    );
    expect(huge.status).toBe(413);
  });
});
