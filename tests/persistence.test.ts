import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { Fragment } from "../contract/memory";
import { withoutJev } from "./helpers";

describe("Memory persistence", () => {
  it("preserves writes, edits, and deletion after eviction without changing memory on recall", async () => {
    const memory = env.MEMORY.getByName("persistence");
    await withoutJev(memory);
    const remember = async (fragment: string): Promise<Fragment> => {
      const result = await memory.remember({ fragment }, "user");
      if ("error" in result) {
        throw new Error(result.error);
      }
      return result;
    };
    const seed = await remember("Durable objects #Programming");
    const neighbor = await remember("Workers #program");
    await evictDurableObject(memory);
    await expect(
      memory.recall({ cue: " DURABLE\nobjects " })
    ).resolves.toStrictEqual({
      fragments: [seed, { ...neighbor, via: ["program"] }],
      hasMore: false,
    });
    const revised = await memory.revise(
      { fragment: "Workers #changed", ref: neighbor.ref },
      "user"
    );
    await evictDurableObject(memory);
    await expect(
      memory.recall({ cue: "Durable objects" })
    ).resolves.toStrictEqual({ fragments: [seed], hasMore: false });
    await expect(memory.recall({ cue: "Workers" })).resolves.toMatchObject({
      fragments: [{ ...revised, fragment: "Workers #changed" }],
    });
    await memory.forget({ ref: seed.ref }, "user");
    await evictDurableObject(memory);
    await expect(
      memory.recall({ cue: "Durable objects" })
    ).resolves.toStrictEqual({ fragments: [], hasMore: false });
    await expect(memory.list({})).resolves.toStrictEqual({
      fragments: [{ ...revised, versions: 2 }],
      nextCursor: null,
    });
  });

  it("migrates each fragment to one record written at its last update", async () => {
    const memory = env.MEMORY.getByName("migration");
    await memory.list({});
    const [first, second] = [
      Date.parse("2026-01-01T00:00:00.000Z"),
      Date.parse("2026-02-01T00:00:00.000Z"),
    ];
    // Roll the object back to the schema before the log.
    await runInDurableObject(memory, (_, state) => {
      const { sql } = state.storage;
      sql.exec("DROP TABLE records");
      sql.exec(
        "CREATE TABLE fragments (id text PRIMARY KEY, content text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL)"
      );
      sql.exec(
        "INSERT INTO fragments VALUES ('abcdefg', 'Old #memsys', ?, ?), ('hjkmnpq', 'Revised', ?, ?)",
        first,
        first,
        first,
        second
      );
      sql.exec(
        "DELETE FROM __drizzle_migrations WHERE name IN ('20260927062704_fragment_log', '20260927110735_activity_ops')"
      );
    });
    await evictDurableObject(memory);
    await expect(memory.list({})).resolves.toStrictEqual({
      fragments: [
        {
          at: "2026-02-01T00:00:00.000Z",
          fragment: "Revised",
          ref: "hjkmnpq",
          versions: 1,
        },
        {
          at: "2026-01-01T00:00:00.000Z",
          fragment: "Old #memsys",
          ref: "abcdefg",
          versions: 1,
        },
      ],
      nextCursor: null,
    });
    await expect(memory.exportLog(true)).resolves.toBe(
      [
        '{"v":1,"ref":"abcdefg","fragment":"Old #memsys","at":"2026-01-01T00:00:00.000Z","op":"remember"}',
        '{"v":1,"ref":"hjkmnpq","fragment":"Revised","at":"2026-02-01T00:00:00.000Z","op":"remember"}',
        "",
      ].join("\n")
    );
  });

  it("gives each earlier record the op its place in the log implies", async () => {
    const memory = env.MEMORY.getByName("op-migration");
    await memory.list({});
    // Roll the object back to the log before ops were kept.
    await runInDurableObject(memory, (_, state) => {
      const { sql } = state.storage;
      sql.exec("DROP TABLE records");
      sql.exec(
        "CREATE TABLE records (at integer NOT NULL, fragment text, ref text NOT NULL, PRIMARY KEY (ref, at))"
      );
      sql.exec(
        "INSERT INTO records VALUES (1, 'First', 'abcdefg'), (2, 'Second', 'abcdefg'), (3, NULL, 'abcdefg'), (4, 'First', 'abcdefg'), (5, 'Second', 'abcdefg'), (2, 'Other', 'hjkmnpq')"
      );
      sql.exec(
        "DELETE FROM __drizzle_migrations WHERE name = '20260927110735_activity_ops'"
      );
    });
    await evictDurableObject(memory);
    const history = await memory.history({ ref: "abcdefg" });
    expect(history?.versions.map(({ by, op }) => [op, by])).toStrictEqual([
      ["revise", null],
      ["restore", null],
      ["forget", null],
      ["revise", null],
      ["remember", null],
    ]);
    await expect(memory.history({ ref: "hjkmnpq" })).resolves.toMatchObject({
      versions: [{ op: "remember" }],
    });
  });

  it("appends one record per write, each later than the last", async () => {
    const memory = env.MEMORY.getByName("append");
    const saved = await memory.remember({ fragment: "One" }, "user");
    if ("error" in saved) {
      throw new Error(saved.error);
    }
    // Back to back, these usually land in the same millisecond.
    await memory.revise({ fragment: "Two", ref: saved.ref }, "user");
    await memory.forget({ ref: saved.ref }, "user");
    await memory.revise({ fragment: "Three", ref: saved.ref }, "user");
    const log = await memory.exportLog(true);
    const lines = log.trimEnd().split("\n");
    const records = lines.map((line) => JSON.parse(line));
    expect(records.map(({ fragment }) => fragment)).toStrictEqual([
      "One",
      "Two",
      null,
    ]);
    const times = records.map(({ at }) => Date.parse(at));
    expect(new Set(times).size).toBe(3);
    expect(times).toStrictEqual(times.toSorted((a, b) => a - b));
  });
});
