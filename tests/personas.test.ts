import type { ActivityPage, Fragment, FragmentPage, Persona } from "@core";
import { env } from "cloudflare:workers";
import type { JSONValue } from "hono/utils/types";
import { describe, expect, it } from "vitest";

import worker from "../worker/index";
import { call, content, ORIGIN, post, randomIp, useAuth } from "./helpers";
import type { User } from "./helpers";

type Listed = Persona & { connections: number; lastChangeAt: string | null };

const api = (
  user: User,
  path: string,
  method = "GET",
  body?: JSONValue,
  headers: Record<string, string> = {}
) =>
  worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body) }),
      headers: {
        "Content-Type": "application/json",
        Cookie: user.cookie,
        ...headers,
      },
    }),
    env
  );

const createPersona = async (user: User, name: string) => {
  const response = await api(user, "/api/personas", "POST", { name });
  expect(response.status).toBe(201);
  return response.json<Persona>();
};

const keyOf = async (user: User, name: string) => {
  const created = await api(
    user,
    "/api/auth/api-key/create",
    "POST",
    { name },
    { Origin: ORIGIN, "cf-connecting-ip": randomIp() }
  );
  const { id, key } = await created.json<{ id: string; key: string }>();
  return { connection: `apiKey:${id}`, user: { ...user, token: key } };
};

const assign = (user: User, connection: string, personaId: string | null) =>
  api(user, "/api/personas/assignments", "PUT", { connection, personaId });

const remember = async (user: User, fragment: string) =>
  content<Fragment>(await call(user, "remember", { fragment }));

const authors = async (user: User, query = "") => {
  const response = await api(user, `/api/activity${query}`);
  const { entries } = await response.json<ActivityPage>();
  return entries.map(({ by, fragment }) => ({ by, fragment }));
};

const by = (author: string) => `?${new URLSearchParams({ by: author })}`;

const listed = async (user: User) => {
  const response = await api(user, "/api/personas");
  return response.json<Listed[]>();
};

const transfer = async (signIn: () => Promise<User>) => {
  const source = await signIn();
  const laptop = await keyOf(source, "Laptop script");
  const work = await createPersona(source, "Work assistant");
  const old = await createPersona(source, "Old bot");
  await assign(source, laptop.connection, work.id);
  await remember(laptop.user, "Deploys go through wrangler");
  await api(source, `/api/personas/${old.id}/archived`, "PUT", {
    archived: true,
  });
  const exported = await api(source, "/api/export?history=true");
  const file = await exported.text();
  const target = await signIn();
  const importFile = () =>
    worker.fetch(
      new Request(`${ORIGIN}/api/import`, {
        body: file,
        headers: {
          "Content-Type": "application/x-ndjson",
          Cookie: target.cookie,
        },
        method: "POST",
      }),
      env
    );
  return { file, importFile, old, target, work };
};

describe("Personas", () => {
  const signIn = useAuth();

  it("records the persona a connection belongs to, and only for later writes", async () => {
    const user = await signIn();
    const laptop = await keyOf(user, "Laptop script");
    const work = await createPersona(user, "Work assistant");
    await remember(laptop.user, "Before assigning");
    await expect(
      assign(user, laptop.connection, work.id)
    ).resolves.toMatchObject({ status: 200 });
    await remember(laptop.user, "After assigning");
    await remember(user, "From the test key");
    await expect(assign(user, laptop.connection, null)).resolves.toMatchObject({
      status: 200,
    });
    await remember(laptop.user, "After removing");
    await expect(authors(user)).resolves.toStrictEqual([
      { by: "agent:Laptop script", fragment: "After removing" },
      { by: "agent:test", fragment: "From the test key" },
      { by: `persona:${work.id}`, fragment: "After assigning" },
      { by: "agent:Laptop script", fragment: "Before assigning" },
    ]);
  });

  it("filters activity to one author", async () => {
    const user = await signIn();
    const laptop = await keyOf(user, "Laptop script");
    const work = await createPersona(user, "Work assistant");
    await assign(user, laptop.connection, work.id);
    await remember(laptop.user, "One");
    await remember(user, "Two");
    await post("/api/remember", { fragment: "Three" }, user);
    await remember(laptop.user, "Four");
    await expect(
      authors(user, by(`persona:${work.id}`))
    ).resolves.toStrictEqual([
      { by: `persona:${work.id}`, fragment: "Four" },
      { by: `persona:${work.id}`, fragment: "One" },
    ]);
    await expect(authors(user, by("user"))).resolves.toStrictEqual([
      { by: "user", fragment: "Three" },
    ]);
    await expect(authors(user, by("agent:test"))).resolves.toStrictEqual([
      { by: "agent:test", fragment: "Two" },
    ]);
  });

  it("lists memories by the author of their current version", async () => {
    const user = await signIn();
    const laptop = await keyOf(user, "Laptop script");
    const work = await createPersona(user, "Work assistant");
    await assign(user, laptop.connection, work.id);
    const revised = await remember(laptop.user, "Deploys use npm");
    await post(
      "/api/revise",
      { fragment: "Deploys use pnpm", ref: revised.ref },
      user
    );
    await remember(laptop.user, "Tests run in workerd");
    const fragments = async (query = "") => {
      const response = await api(user, `/api/fragments${query}`);
      const page = await response.json<FragmentPage>();
      return page.fragments.map((item) => ({
        by: item.by,
        fragment: item.fragment,
      }));
    };
    await expect(fragments()).resolves.toStrictEqual([
      { by: `persona:${work.id}`, fragment: "Tests run in workerd" },
      { by: "user", fragment: "Deploys use pnpm" },
    ]);
    await expect(fragments(by(`persona:${work.id}`))).resolves.toStrictEqual([
      { by: `persona:${work.id}`, fragment: "Tests run in workerd" },
    ]);
    await expect(fragments(by("user"))).resolves.toStrictEqual([
      { by: "user", fragment: "Deploys use pnpm" },
    ]);
  });

  it("keeps the persona id on old records when the persona is renamed", async () => {
    const user = await signIn();
    const laptop = await keyOf(user, "Laptop script");
    const persona = await createPersona(user, "Wrok assistant");
    await assign(user, laptop.connection, persona.id);
    await remember(laptop.user, "Written before the rename");
    const renamed = await api(user, `/api/personas/${persona.id}`, "PATCH", {
      name: "Work assistant",
    });
    expect(renamed.status).toBe(200);
    await expect(authors(user)).resolves.toStrictEqual([
      { by: `persona:${persona.id}`, fragment: "Written before the rename" },
    ]);
    await expect(listed(user)).resolves.toMatchObject([
      { connections: 1, id: persona.id, name: "Work assistant" },
    ]);
  });

  it("refuses a write for a persona the memory does not have, and stores nothing", async () => {
    const user = await signIn();
    const laptop = await keyOf(user, "Laptop script");
    await env.DB.prepare(
      'INSERT INTO "connectionPersonas" ("userId", "connection", "personaId") VALUES (?, ?, ?)'
    )
      .bind(user.id, laptop.connection, "missingid2")
      .run();
    const result = await call(laptop.user, "remember", { fragment: "Lost" });
    expect(result.isError).toBeTruthy();
    await expect(authors(user)).resolves.toStrictEqual([]);
  });

  it("removes every connection from a persona when it is archived", async () => {
    const user = await signIn();
    const laptop = await keyOf(user, "Laptop script");
    const old = await createPersona(user, "Old bot");
    await assign(user, laptop.connection, old.id);
    const archived = await api(
      user,
      `/api/personas/${old.id}/archived`,
      "PUT",
      {
        archived: true,
      }
    );
    expect(archived.status).toBe(200);
    await remember(laptop.user, "After archiving");
    await expect(authors(user)).resolves.toStrictEqual([
      { by: "agent:Laptop script", fragment: "After archiving" },
    ]);
    await expect(
      assign(user, laptop.connection, old.id)
    ).resolves.toMatchObject({ status: 422 });
    await expect(listed(user)).resolves.toMatchObject([
      { connections: 0, id: old.id },
    ]);
    await api(user, `/api/personas/${old.id}/archived`, "PUT", {
      archived: false,
    });
    await expect(listed(user)).resolves.toMatchObject([
      { archivedAt: null, connections: 0, id: old.id },
    ]);
  });

  it("assigns only the user's own connections", async () => {
    const owner = await signIn();
    const other = await signIn();
    const laptop = await keyOf(owner, "Laptop script");
    const persona = await createPersona(other, "Someone else's agent");
    await expect(
      assign(other, laptop.connection, persona.id)
    ).resolves.toMatchObject({ status: 404 });
    await remember(laptop.user, "Still the owner's");
    await expect(authors(owner)).resolves.toStrictEqual([
      { by: "agent:Laptop script", fragment: "Still the owner's" },
    ]);
  });

  it("does not count a revoked key as a connection", async () => {
    const user = await signIn();
    const laptop = await keyOf(user, "Laptop script");
    const persona = await createPersona(user, "Work assistant");
    await assign(user, laptop.connection, persona.id);
    await api(
      user,
      "/api/auth/api-key/delete",
      "POST",
      { keyId: laptop.connection.slice("apiKey:".length) },
      { Origin: ORIGIN }
    );
    await expect(listed(user)).resolves.toMatchObject([{ connections: 0 }]);
  });

  it("moves personas and their history to a new space", async () => {
    const { file, importFile, old, target, work } = await transfer(signIn);
    await expect(importFile()).resolves.toMatchObject({ status: 200 });
    const [importedWork, importedOld] = await listed(target);
    expect([importedWork, importedOld?.archivedAt !== null]).toMatchObject([
      { archivedAt: null, id: work.id, name: "Work assistant" },
      true,
    ]);

    const newKey = await keyOf(target, "New laptop");
    await assign(target, newKey.connection, work.id);
    await remember(newKey.user, "Written on the new instance");
    const activity = await api(
      target,
      `/api/activity${by(`persona:${work.id}`)}`
    );
    const { entries } = await activity.json<ActivityPage>();
    expect(
      entries.map(({ by: author, fragment }) => ({ author, fragment }))
    ).toStrictEqual([
      { author: `persona:${work.id}`, fragment: "Written on the new instance" },
      { author: `persona:${work.id}`, fragment: "Deploys go through wrangler" },
    ]);

    const placeholders = new Map([
      [work.id, "<work-persona>"],
      [old.id, "<archived-persona>"],
      ...entries.map(({ ref }, index): [string, string] => [
        ref,
        `<ref-${index + 1}>`,
      ]),
    ]);
    const stable = (text: string) => {
      let result = text.replaceAll(/\d{4}-\d\d-\d\dT[\d:.]+Z/gu, "<time>");
      for (const [value, placeholder] of placeholders) {
        result = result.replaceAll(value, placeholder);
      }
      return result;
    };
    await expect(
      [
        "# Export from the first space",
        stable(file).trim(),
        "",
        "# Activity for the work persona in the second space",
        stable(JSON.stringify(entries, null, 2)),
        "",
      ].join("\n")
    ).toMatchFileSnapshot("./artifacts/persona-transfer.txt");
  });

  it("leaves local persona names alone on a second import", async () => {
    const { importFile, old, target, work } = await transfer(signIn);
    await expect(importFile()).resolves.toMatchObject({ status: 200 });
    await api(target, `/api/personas/${work.id}`, "PATCH", {
      name: "Renamed here",
    });
    await expect(importFile()).resolves.toMatchObject({ status: 200 });
    await expect(listed(target)).resolves.toMatchObject([
      { id: work.id, name: "Renamed here" },
      { id: old.id },
    ]);
  });
});
