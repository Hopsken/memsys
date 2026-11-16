import type { ActivityPage, FragmentPage, Persona } from "@core";
import { env } from "cloudflare:workers";
import type { JSONValue } from "hono/utils/types";
import { describe, expect, it } from "vitest";

import worker from "../worker/index";
import { faux } from "./faux-provider";
import { call, ORIGIN, list, post, randomIp, text, useAuth } from "./helpers";
import type { User } from "./helpers";
import { scripted, useFauxModel } from "./subagent";

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

const stored = async (user: User, fragment: string) => {
  const page = await list(user);
  const item = page.fragments.find((each) => each.fragment === fragment);
  if (!item) {
    throw new TypeError(`Memory not stored: ${fragment}`);
  }
  return item;
};

const remember = async (user: User, fragment: string) => {
  const script = scripted();
  faux.setResponses([
    script.tool("remember", { fragment }),
    script.text("Stored."),
  ]);
  const result = await call(user, "note", { context: fragment });
  if (result.isError) {
    throw new TypeError(text(result));
  }
  return stored(user, fragment);
};

const revise = async (user: User, fragment: string, ref: string) => {
  const script = scripted();
  faux.setResponses([
    script.tool("revise", { fragment, ref }),
    script.text("Revised."),
  ]);
  const result = await call(user, "note", { context: fragment });
  if (result.isError) {
    throw new TypeError(text(result));
  }
  return stored(user, fragment);
};

const changes = async (user: User, query = "") => {
  const response = await api(user, `/api/activity${query}`);
  const { entries } = await response.json<ActivityPage>();
  return entries.map(({ fragment, source }) => ({ fragment, source }));
};

const withSource = (source: string) => `?${new URLSearchParams({ source })}`;

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
  useFauxModel();

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
    await expect(changes(user)).resolves.toStrictEqual([
      { fragment: "After removing", source: "agent:Laptop script" },
      { fragment: "From the test key", source: "agent:test" },
      { fragment: "After assigning", source: `persona:${work.id}` },
      { fragment: "Before assigning", source: "agent:Laptop script" },
    ]);
  });

  it("filters activity to one source", async () => {
    const user = await signIn();
    const laptop = await keyOf(user, "Laptop script");
    const work = await createPersona(user, "Work assistant");
    await assign(user, laptop.connection, work.id);
    await remember(laptop.user, "One");
    await remember(user, "Two");
    await post("/api/remember", { fragment: "Three" }, user);
    await remember(laptop.user, "Four");
    await expect(
      changes(user, withSource(`persona:${work.id}`))
    ).resolves.toStrictEqual([
      { fragment: "Four", source: `persona:${work.id}` },
      { fragment: "One", source: `persona:${work.id}` },
    ]);
    await expect(changes(user, withSource("user"))).resolves.toStrictEqual([
      { fragment: "Three", source: "user" },
    ]);
    await expect(
      changes(user, withSource("agent:test"))
    ).resolves.toStrictEqual([{ fragment: "Two", source: "agent:test" }]);
  });

  it("lists memories from the source of their current version", async () => {
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
        fragment: item.fragment,
        source: item.source,
      }));
    };
    await expect(fragments()).resolves.toStrictEqual([
      { fragment: "Tests run in workerd", source: `persona:${work.id}` },
      { fragment: "Deploys use pnpm", source: "user" },
    ]);
    await expect(
      fragments(withSource(`persona:${work.id}`))
    ).resolves.toStrictEqual([
      { fragment: "Tests run in workerd", source: `persona:${work.id}` },
    ]);
    await expect(fragments(withSource("user"))).resolves.toStrictEqual([
      { fragment: "Deploys use pnpm", source: "user" },
    ]);
  });

  it("records the source of each memory", async () => {
    const user = await signIn();
    const laptop = await keyOf(user, "Laptop script");
    const retired = await keyOf(user, "Retired script");
    const work = await createPersona(user, "Wrok assistant");
    const old = await createPersona(user, "Old bot");
    await assign(user, laptop.connection, work.id);
    await assign(user, retired.connection, old.id);
    await remember(laptop.user, "Kyoto trip uses the JR pass");
    await post("/api/remember", { fragment: "Kyoto ryokan is booked" }, user);
    await remember(user, "Kyoto flights leave from PVG");
    await remember(retired.user, "Kyoto budget is 3000 USD");
    const revised = await remember(user, "Kyoto hotel near Gion");
    await revise(laptop.user, "Kyoto hotel near Kyoto Station", revised.ref);
    const { fragments } = await list(user);
    expect(
      Object.fromEntries(
        fragments.map((item) => [item.fragment, item.source ?? null])
      )
    ).toStrictEqual({
      "Kyoto budget is 3000 USD": `persona:${old.id}`,
      "Kyoto flights leave from PVG": "agent:test",
      "Kyoto hotel near Kyoto Station": `persona:${work.id}`,
      "Kyoto ryokan is booked": "user",
      "Kyoto trip uses the JR pass": `persona:${work.id}`,
    });
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
    await expect(changes(user)).resolves.toStrictEqual([
      {
        fragment: "Written before the rename",
        source: `persona:${persona.id}`,
      },
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
    const script = scripted();
    faux.setResponses([
      script.tool("remember", { fragment: "Lost" }),
      script.text("Could not store it."),
    ]);
    const result = await call(laptop.user, "note", { context: "Lost" });
    expect(text(result)).toBe("No memories changed.");
    await expect(changes(user)).resolves.toStrictEqual([]);
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
    await expect(changes(user)).resolves.toStrictEqual([
      { fragment: "After archiving", source: "agent:Laptop script" },
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
    await expect(changes(owner)).resolves.toStrictEqual([
      { fragment: "Still the owner's", source: "agent:Laptop script" },
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
      `/api/activity${withSource(`persona:${work.id}`)}`
    );
    const { entries } = await activity.json<ActivityPage>();
    expect(
      entries.map(({ fragment, source }) => ({ fragment, source }))
    ).toStrictEqual([
      { fragment: "Written on the new instance", source: `persona:${work.id}` },
      { fragment: "Deploys go through wrangler", source: `persona:${work.id}` },
    ]);

    const placeholders = new Map([
      [work.id, "<work-persona>"],
      [old.id, "<archived-persona>"],
      ...entries.map(({ ref }, index): [string, string] => [
        ref,
        `<ref-${index + 1}>`,
      ]),
    ]);
    const stable = (raw: string) => {
      let result = raw.replaceAll(/\d{4}-\d\d-\d\dT[\d:.]+Z/gu, "<time>");
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
