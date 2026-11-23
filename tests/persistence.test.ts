import { LOG_CURSOR_KEY } from "@core";
import type { Fragment } from "@core";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Memory persistence", () => {
  it("preserves writes, edits, and deletion after eviction", async () => {
    const memory = env.MEMORY.getByName("persistence");
    const remember = async (fragment: string): Promise<Fragment> => {
      const result = await memory.remember({ fragment }, "user");
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.value;
    };
    const seed = await remember("Durable objects #Programming");
    const neighbor = await remember("Workers #program");
    await evictDurableObject(memory);
    await expect(memory.list({})).resolves.toMatchObject({
      fragments: [
        { fragment: "Workers #program", ref: neighbor.ref },
        { fragment: "Durable objects #Programming", ref: seed.ref },
      ],
    });
    const revised = await memory.revise(
      { fragment: "Workers #changed", ref: neighbor.ref },
      "user"
    );
    if (!revised.ok) {
      throw new Error(revised.error.reason);
    }
    await evictDurableObject(memory);
    await expect(memory.list({})).resolves.toMatchObject({
      fragments: [
        { fragment: "Workers #changed", ref: neighbor.ref },
        { fragment: "Durable objects #Programming" },
      ],
    });
    await memory.forget({ ref: seed.ref }, "user");
    await evictDurableObject(memory);
    await expect(memory.list({})).resolves.toStrictEqual({
      fragments: [{ ...revised.value, source: "user", versions: 2 }],
      nextCursor: null,
    });
    const snapshot = await memory.readLog({});
    expect({
      fragments: snapshot.fragments.map(({ fragment }) => fragment),
      records: snapshot.records,
    }).toStrictEqual({
      fragments: ["Workers #changed"],
      records: [],
    });
    const log = await memory.readLog({ after: 0 });
    expect(log.records.map(({ fragment }) => fragment)).toStrictEqual([
      "Durable objects #Programming",
      "Workers #program",
      "Workers #changed",
      null,
    ]);
  });

  it("gives every new record a larger id, even when clocks tie", async () => {
    const memory = env.MEMORY.getByName("timestamps");
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        memory.remember({ fragment: `Item ${index}` }, "user")
      )
    );
    const ids = results.flatMap((result) =>
      result.ok ? [result.value.versionId] : []
    );
    const times = results.flatMap((result) =>
      result.ok ? [Date.parse(result.value.createdAt)] : []
    );
    expect(new Set(ids).size).toBe(20);
    expect(ids).toStrictEqual(ids.toSorted((a, b) => a - b));
    expect(
      times.every((time) => Number.isFinite(time) && time > 0)
    ).toBeTruthy();
  });

  it("migrates each fragment to one record written at its last update", async () => {
    const memory = env.MEMORY.getByName("migration");
    await memory.list({});
    const [first, second] = [
      Date.parse("2026-01-01T00:00:00.000Z"),
      Date.parse("2026-02-01T00:00:00.000Z"),
    ];
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
        "INSERT INTO metadata (key, value) VALUES ('logCursor', '{\"cursor\":1763000000000}')"
      );
      sql.exec(
        "DELETE FROM __drizzle_migrations WHERE name IN ('20260927062704_fragment_log', '20260927110735_activity_ops', '20261116091431_by_to_source', '20261119043402_log-sequence')"
      );
    });
    await evictDurableObject(memory);
    await expect(memory.list({})).resolves.toStrictEqual({
      fragments: [
        {
          createdAt: "2026-02-01T00:00:00.000Z",
          fragment: "Revised",
          ref: "hjkmnpq",
          source: null,
          updatedAt: "2026-02-01T00:00:00.000Z",
          versionId: 2,
          versions: 1,
        },
        {
          createdAt: "2026-01-01T00:00:00.000Z",
          fragment: "Old #memsys",
          ref: "abcdefg",
          source: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
          versionId: 1,
          versions: 1,
        },
      ],
      nextCursor: null,
    });
    await expect(memory.exportLog({ history: true })).resolves.toBe(
      [
        '{"v":1,"ref":"abcdefg","fragment":"Old #memsys","createdAt":"2026-01-01T00:00:00.000Z","op":"remember"}',
        '{"v":1,"ref":"hjkmnpq","fragment":"Revised","createdAt":"2026-02-01T00:00:00.000Z","op":"remember"}',
        "",
      ].join("\n")
    );
    await expect(memory.readMetadata(LOG_CURSOR_KEY)).resolves.toBeNull();
  });

  it("keeps existing records when the source column is renamed", async () => {
    const memory = env.MEMORY.getByName("source-migration");
    await memory.list({});
    await runInDurableObject(memory, (_, state) => {
      const { sql } = state.storage;
      sql.exec("DROP TABLE records");
      sql.exec(
        "CREATE TABLE records (at integer NOT NULL, by text, fragment text, op text NOT NULL, ref text NOT NULL, PRIMARY KEY (ref, at))"
      );
      sql.exec("CREATE INDEX records_at_ref_idx ON records (at, ref)");
      sql.exec(
        "INSERT INTO records VALUES (1, 'persona:seedwrk', 'Deploys go through wrangler', 'remember', 'abcdefg'), (2, 'user', 'Prefers pnpm', 'remember', 'hjkmnpq'), (3, NULL, 'Imported long ago', 'remember', 'klmnpqr')"
      );
      sql.exec(
        "DELETE FROM __drizzle_migrations WHERE name IN ('20261116091431_by_to_source', '20261119043402_log-sequence')"
      );
    });
    await evictDurableObject(memory);
    const renamed = await runInDurableObject(memory, (_, state) =>
      state.storage.sql
        .exec("SELECT createdAt, source FROM records ORDER BY createdAt")
        .toArray()
    );
    expect(renamed).toStrictEqual([
      { createdAt: 1, source: "persona:seedwrk" },
      { createdAt: 2, source: "user" },
      { createdAt: 3, source: null },
    ]);
    await expect(memory.list({})).resolves.toStrictEqual({
      fragments: [
        {
          createdAt: new Date(3).toISOString(),
          fragment: "Imported long ago",
          ref: "klmnpqr",
          source: null,
          updatedAt: new Date(3).toISOString(),
          versionId: 3,
          versions: 1,
        },
        {
          createdAt: new Date(2).toISOString(),
          fragment: "Prefers pnpm",
          ref: "hjkmnpq",
          source: "user",
          updatedAt: new Date(2).toISOString(),
          versionId: 2,
          versions: 1,
        },
        {
          createdAt: new Date(1).toISOString(),
          fragment: "Deploys go through wrangler",
          ref: "abcdefg",
          source: "persona:seedwrk",
          updatedAt: new Date(1).toISOString(),
          versionId: 1,
          versions: 1,
        },
      ],
      nextCursor: null,
    });
  });

  it("gives each earlier record the op its place in the log implies", async () => {
    const memory = env.MEMORY.getByName("op-migration");
    await memory.list({});
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
        "DELETE FROM __drizzle_migrations WHERE name IN ('20260927110735_activity_ops', '20261116091431_by_to_source', '20261119043402_log-sequence')"
      );
    });
    await evictDurableObject(memory);
    const history = await memory.history({ ref: "abcdefg" });
    if (!history.ok) {
      throw new Error(history.error.reason);
    }
    expect(
      history.value.versions.map(({ op, source }) => [op, source])
    ).toStrictEqual([
      ["revise", null],
      ["restore", null],
      ["forget", null],
      ["revise", null],
      ["remember", null],
    ]);
    await expect(memory.history({ ref: "hjkmnpq" })).resolves.toMatchObject({
      value: { versions: [{ op: "remember" }] },
    });
  });

  it("addresses a version by id and never reuses one", async () => {
    const memory = env.MEMORY.getByName("version-ids");
    const kept = await memory.remember({ fragment: "Kept" }, "user");
    const other = await memory.remember({ fragment: "Other" }, "user");
    const purged = await memory.remember({ fragment: "Purged" }, "user");
    if (!kept.ok || !other.ok || !purged.ok) {
      throw new Error("Seeding failed");
    }
    await expect(
      memory.restore({ id: other.value.versionId, ref: kept.value.ref })
    ).resolves.toMatchObject({ error: { reason: "version-not-found" } });
    await memory.purge({ ref: purged.value.ref });
    const next = await memory.remember({ fragment: "Next" }, "user");
    if (!next.ok) {
      throw new Error(next.error.message);
    }
    expect(next.value.versionId).toBeGreaterThan(purged.value.versionId);
  });

  it("appends one record per write, each later than the last", async () => {
    const memory = env.MEMORY.getByName("append");
    const saved = await memory.remember({ fragment: "One" }, "user");
    if (!saved.ok) {
      throw new Error(saved.error.message);
    }
    const { ref } = saved.value;
    await memory.revise({ fragment: "Two", ref }, "user");
    await memory.forget({ ref }, "user");
    await memory.revise({ fragment: "Three", ref }, "user");
    const log = await memory.exportLog({ history: true });
    const lines = log.trimEnd().split("\n");
    const records = lines.map((line) => JSON.parse(line));
    expect(records.map(({ fragment }) => fragment)).toStrictEqual([
      "One",
      "Two",
      null,
    ]);
    const rows = await runInDurableObject(memory, (_, state) =>
      state.storage.sql
        .exec<{ createdAt: number; id: number }>(
          "SELECT id, createdAt FROM records ORDER BY id"
        )
        .toArray()
    );
    expect(rows.map(({ id }) => id)).toStrictEqual([1, 2, 3]);
    const times = rows.map(({ createdAt }) => createdAt);
    expect(times).toStrictEqual(times.toSorted((a, b) => a - b));
  });
});
