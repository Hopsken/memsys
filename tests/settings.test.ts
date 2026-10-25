import migrations from "@core/migrations/migrations.js";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { JSONValue } from "hono/utils/types";
import { describe, expect, it, vi } from "vitest";

import worker from "../worker/index";
import type { SettingsView } from "../worker/services/settings";
import { patchSettings, useAuth } from "./helpers";
import type { User } from "./helpers";

const DEFAULTS = {
  instructions: "",
  length: { refuse: 500, warn: 300 },
  relevanceFilter: "off",
};

const read = async (user: User) => {
  const response = await worker.fetch(
    new Request("https://memsys.test/api/settings", {
      headers: { Cookie: user.cookie },
    }),
    env
  );
  return response.json<SettingsView>();
};

const save = async (user: User, patch: JSONValue) => {
  const response = await patchSettings(user, patch);
  return { body: await response.json(), status: response.status };
};

const PLUGIN_ROWS = {
  jevOff: [["jev", 0, '{"strictness":"max"}', 3]],
  jevOn: [
    ["size-limit", 1, '{"hard":400,"soft":200}', 5],
    ["jev", 1, '{"strictness":"high"}', 9],
  ],
  sizeLimitOff: [["size-limit", 0, '{"hard":400,"soft":200}', 5]],
  thresholdOnly: [["jev", 1, '{"threshold":0.4}', 3]],
};

describe("Settings", () => {
  const signIn = useAuth();

  it("starts at the defaults", async () => {
    await expect(read(await signIn())).resolves.toStrictEqual({
      defaults: DEFAULTS,
      settings: DEFAULTS,
    });
  });

  it("validates, changes only the fields given, resets with null, and keeps them across restarts", async () => {
    const user = await signIn();
    const invalid = await save(user, { length: { refuse: 10, warn: 20 } });
    const unknown = await save(user, { theme: "dark" });
    await save(user, { length: { refuse: 20, warn: 10 } });
    const both = await save(user, { relevanceFilter: "low" });
    await evictDurableObject(env.MEMORY.getByName(user.id));
    const persisted = await read(user);
    const reset = await save(user, { length: null });
    expect({
      both,
      invalid,
      persisted: persisted.settings,
      reset,
      unknown,
    }).toMatchObject({
      both: {
        body: {
          settings: {
            length: { refuse: 20, warn: 10 },
            relevanceFilter: "low",
          },
        },
        status: 200,
      },
      invalid: {
        body: { issues: [{ path: ["length", "warn"] }] },
        status: 422,
      },
      persisted: { length: { refuse: 20, warn: 10 }, relevanceFilter: "low" },
      reset: {
        body: { settings: { ...DEFAULTS, relevanceFilter: "low" } },
        status: 200,
      },
      unknown: { status: 422 },
    });
  });

  it("uses the default for a stored field that no longer parses", async () => {
    const log = vi.spyOn(console, "error").mockReturnValue();
    const user = await signIn();
    await runInDurableObject(env.MEMORY.getByName(user.id), (_, state) => {
      state.storage.sql.exec(
        `INSERT INTO metadata (key, value) VALUES ('settings', '{"length":{"refuse":"big"},"relevanceFilter":"high"}')`
      );
    });
    await evictDurableObject(env.MEMORY.getByName(user.id));
    await expect(read(user)).resolves.toMatchObject({
      settings: { ...DEFAULTS, relevanceFilter: "high" },
    });
    log.mockRestore();
  });

  it("carries plugin settings over in the migration that replaced them", async () => {
    const [, insert = "", drop = ""] =
      migrations.migrations["20261024035713_metadata"]?.split(
        "--> statement-breakpoint"
      ) ?? [];
    const migrated = await Promise.all(
      Object.values(PLUGIN_ROWS).map(async (rows) => {
        const user = await signIn();
        const memory = env.MEMORY.getByName(user.id);
        await runInDurableObject(memory, (_, { storage: { sql } }) => {
          sql.exec("DELETE FROM metadata");
          sql.exec(
            "CREATE TABLE plugin_config (config text NOT NULL, enabled integer NOT NULL, name text PRIMARY KEY, updated_at integer NOT NULL)"
          );
          for (const [name, enabled, config, updatedAt] of rows) {
            sql.exec(
              "INSERT INTO plugin_config (name, enabled, config, updated_at) VALUES (?, ?, ?, ?)",
              name,
              enabled,
              config,
              updatedAt
            );
          }
          sql.exec(insert);
          sql.exec(drop);
        });
        await evictDurableObject(memory);
        const { settings } = await read(user);
        return settings;
      })
    );
    expect(migrated).toStrictEqual([
      DEFAULTS,
      {
        ...DEFAULTS,
        length: { refuse: 400, warn: 200 },
        relevanceFilter: "high",
      },
      { ...DEFAULTS, length: { refuse: 1000, warn: 1000 } },
      { ...DEFAULTS, relevanceFilter: "medium" },
    ]);
  });

  it("guards saves like every other write", async () => {
    const user = await signIn();
    const send = (headers: Record<string, string>) =>
      worker.fetch(
        new Request("https://memsys.test/api/settings", {
          body: JSON.stringify({ relevanceFilter: "low" }),
          headers: { Cookie: user.cookie, ...headers },
          method: "PATCH",
        }),
        env
      );
    const statuses = await Promise.all([
      send({ "Content-Type": "text/plain" }),
      send({ "Content-Type": "application/json", Origin: "https://evil.test" }),
    ]).then((responses) => responses.map((response) => response.status));
    expect(statuses).toStrictEqual([415, 403]);
  });
});
