import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { describe, expect, it } from "vitest";

import worker from "../src/index";

describe("Worker scaffold", () => {
  it("has no application routes", async () => {
    const response = await worker.fetch(
      new Request("https://memsys.test/"),
      env
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("404 Not Found");
  });

  it("initializes Drizzle migrations in each SQLite object", async () => {
    const stub = env.MEMORY.getByName("migration-test");

    await runInDurableObject(stub, (_instance, state) => {
      const db = drizzle(state.storage);
      const result = db.all(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`
      );

      expect(result).toEqual([{ name: "__drizzle_migrations" }]);
      expect(db.all(sql`SELECT * FROM __drizzle_migrations`)).toEqual([]);
    });
  });

  it("keeps SQLite data isolated between object identities", async () => {
    const first = env.MEMORY.getByName("first");
    const second = env.MEMORY.getByName("second");

    await runInDurableObject(first, (_instance, state) => {
      const db = drizzle(state.storage);
      db.run(sql`CREATE TABLE probe (value INTEGER NOT NULL)`);
      db.run(sql`INSERT INTO probe (value) VALUES (17)`);
    });

    await runInDurableObject(second, (_instance, state) => {
      const db = drizzle(state.storage);
      expect(
        db.all(sql`SELECT name FROM sqlite_master WHERE name = 'probe'`)
      ).toEqual([]);
    });

    await runInDurableObject(first, (_instance, state) => {
      const db = drizzle(state.storage);
      expect(db.all(sql`SELECT value FROM probe`)).toEqual([{ value: 17 }]);
    });
  });
});
