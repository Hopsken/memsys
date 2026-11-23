import type { Fragment } from "@core";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import worker from "../worker/index";
import { defaultSpace, openMemory } from "../worker/memory";
import type { TidyState } from "../worker/tidy/model";
import { faux } from "./faux-provider";
import { ORIGIN, post, useAuth } from "./helpers";
import type { User } from "./helpers";
import { scripted, useFauxModel } from "./subagent";

const request = (method: string, path: string, user: User) =>
  worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      headers: { Cookie: user.cookie },
      method,
    }),
    env
  );

const tidyState = async (response: Response) => {
  if (!response.ok) {
    throw new Error(`${response.status}: ${await response.text()}`);
  }
  return response.json<TidyState>();
};

const read = async (user: User) =>
  tidyState(await request("GET", "/api/tidy", user));

const start = async (user: User) =>
  tidyState(await post("/api/tidy", {}, user));

const runScheduledTidy = async (user: User) => {
  await runDurableObjectAlarm(env.TIDY.getByName(defaultSpace(user.id)));
  return vi.waitFor(async () => {
    const state = await read(user);
    if (state.status === "running") {
      throw new Error("Still running");
    }
    return state;
  });
};

const remember = async (user: User, fragment: string) => {
  const response = await post("/api/remember", { fragment }, user);
  return response.json<Fragment>();
};

const proposalsOf = (state: TidyState) => {
  if (state.status !== "ready") {
    throw new Error(`Expected ready, got ${state.status}`);
  }
  return state.proposals;
};

type Block = AssistantMessage["content"][number];

const blockText = (block: Block) => {
  if (block.type === "toolCall") {
    return `toolCall ${block.name} ${JSON.stringify(block.arguments)}`;
  }
  return block.type === "text" ? block.text : "";
};

const messageText = (message: Message) => {
  switch (message.role) {
    case "assistant": {
      return message.content.map(blockText).join("\n");
    }
    case "toolResult": {
      const text = message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");
      return `${message.toolName}${message.isError ? " (error)" : ""}: ${text}`;
    }
    default: {
      return z
        .array(z.object({ text: z.string() }))
        .parse(message.content)
        .map(({ text }) => text)
        .join("");
    }
  }
};

describe("Tidy up", () => {
  const signIn = useAuth();
  useFauxModel();

  it("proposes without writing, then applies chosen proposals as memsys and skips stale ones", async () => {
    const user = await signIn();
    const bun = await remember(user, "Prefers bun over pnpm");
    const switched = await remember(user, "Switched to bun last month");
    const trip = await remember(
      user,
      "Flying to Lisbon next week to visit Mei"
    );
    const seats = await remember(
      user,
      "Prefers aisle seats and no meetings before 10am"
    );
    const kept = await remember(user, "Sister Mei lives in Lisbon");

    const script = scripted();
    faux.setResponses([
      script.tools([
        [
          "propose_change",
          {
            changes: [
              {
                fragment: "Switched from pnpm to bun and prefers it",
                ref: bun.ref,
                type: "revise",
              },
              { ref: switched.ref, type: "forget" },
            ],
            reason: "Two memories say the same thing.",
          },
        ],
        [
          "propose_change",
          {
            changes: [{ ref: "nosuchref", type: "forget" }],
            reason: "Unknown memory.",
          },
        ],
        [
          "propose_change",
          {
            changes: [{ fragment: "Visited Mei", type: "revise" }],
            reason: "A revise without a ref.",
          },
        ],
        [
          "propose_change",
          {
            changes: [
              {
                fragment: "Prefers aisle seats",
                ref: seats.ref,
                type: "revise",
              },
              { fragment: "No meetings before 10am", type: "remember" },
            ],
            reason: "This memory holds two ideas.",
          },
        ],
        [
          "propose_change",
          {
            changes: [
              {
                fragment: "Visited Mei in Lisbon in November 2026",
                ref: trip.ref,
                type: "revise",
              },
            ],
            reason: "The trip date has passed.",
          },
        ],
        [
          "propose_change",
          {
            changes: [{ ref: trip.ref, type: "forget" }],
            reason: "A second change to the same memory.",
          },
        ],
      ]),
      script.text("Found a duplicate, a mixed memory, and a past trip."),
    ]);

    const running = await start(user);
    const again = await start(user);
    expect(again).toStrictEqual(running);

    const ready = await runScheduledTidy(user);
    const proposals = proposalsOf(ready);
    const before = await openMemory(defaultSpace(user.id)).exportLog({
      history: true,
    });

    await post(
      "/api/revise",
      { fragment: "Flying to Lisbon on Friday", ref: trip.ref },
      user
    );
    const applied = await tidyState(
      await post(
        "/api/tidy/apply",
        { proposals: proposals.map(({ id }) => id) },
        user
      )
    );
    const memory = openMemory(defaultSpace(user.id));
    const after = await memory.exportLog({ history: true });
    const { fragments } = await memory.readLog({});

    const placeholders = new Map(
      [bun, switched, trip, seats, kept].map(({ ref }, index) => [
        ref,
        `<ref-${index + 1}>`,
      ])
    );
    for (const { ref } of fragments) {
      if (!placeholders.has(ref)) {
        placeholders.set(ref, `<ref-${placeholders.size + 1}>`);
      }
    }
    const stable = (value: string) => {
      let result = value
        .replaceAll(/\d{4}-\d\d-\d\dT[\d:.]+Z/gu, "<time>")
        .replaceAll(
          /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/gu,
          "<id>"
        );
      for (const [ref, name] of placeholders) {
        result = result.replaceAll(ref, name);
      }
      return result;
    };
    const [first] = script.requests;
    const messages = script.requests.at(-1)?.context.messages ?? [];
    const trace = [
      "# Scripted tidy-up run",
      "",
      "## Tools offered",
      (first?.context.messages[0]?.role === "system"
        ? (first.context.messages[0].toolsAdded ?? [])
        : []
      )
        .map((tool) => tool.name)
        .join(", "),
      "",
      "## Model input (after the shared system prompt)",
      stable(messages[1] ? messageText(messages[1]) : ""),
      "",
      "## Model turns",
      ...messages
        .slice(2)
        .map((message) => `${message.role}:\n${stable(messageText(message))}`),
      "",
      "## Proposals for review",
      stable(JSON.stringify(ready, null, 2)),
      "",
      "## Apply result",
      stable(JSON.stringify(applied, null, 2)),
      "",
      "## Memory log after applying",
      stable(after).trimEnd(),
      "",
    ].join("\n");

    expect([
      before.trimEnd().split("\n").length,
      proposals.map(({ reason }) => reason),
    ]).toStrictEqual([
      5,
      [
        "Two memories say the same thing.",
        "This memory holds two ideas.",
        "The trip date has passed.",
      ],
    ]);
    expect(applied).toMatchObject({
      last: { applied: 2, skipped: [{ reason: expect.any(String) }] },
      status: "idle",
    });
    expect(
      fragments.map(({ fragment, source }) => [fragment, source])
    ).toStrictEqual([
      ["Switched from pnpm to bun and prefers it", "system"],
      ["Flying to Lisbon on Friday", "user"],
      ["Prefers aisle seats", "system"],
      ["Sister Mei lives in Lisbon", "user"],
      ["No meetings before 10am", "system"],
    ]);
    await expect(trace).toMatchFileSnapshot("./artifacts/tidy.txt");
  });

  it("cancels a run and discards whatever it found", async () => {
    const user = await signIn();
    await remember(user, "Prefers bun over pnpm");
    const script = scripted();
    faux.setResponses([script.text("Nothing to change.")]);

    const running = await start(user);
    const cancelled = await tidyState(
      await request("DELETE", "/api/tidy", user)
    );
    const after = await runScheduledTidy(user);
    const apply = await post("/api/tidy/apply", { proposals: [] }, user);

    expect(running.status).toBe("running");
    expect(cancelled).toStrictEqual({ status: "idle" });
    expect(after).toStrictEqual({ status: "idle" });
    expect(apply.status).toBe(409);
  });

  it("reports a model failure and writes nothing", async () => {
    const user = await signIn();
    await remember(user, "Prefers bun over pnpm");
    const script = scripted();
    faux.setResponses([script.fail("upstream timeout")]);

    await start(user);
    const state = await runScheduledTidy(user);
    const { fragments } = await openMemory(defaultSpace(user.id)).readLog({});

    expect(state).toMatchObject({ retry: true, status: "failed" });
    expect(fragments).toHaveLength(1);
  });

  it("finds nothing to tidy in an empty memory without calling the model", async () => {
    const user = await signIn();
    const script = scripted();

    await start(user);
    const state = await runScheduledTidy(user);

    expect(proposalsOf(state)).toStrictEqual([]);
    expect(script.requests).toHaveLength(0);
  });

  it("is not reachable with an agent key", async () => {
    const user = await signIn();
    const response = await worker.fetch(
      new Request(`${ORIGIN}/api/tidy`, {
        headers: { Authorization: `Bearer ${user.token}` },
      }),
      env
    );

    expect(response.status).toBe(401);
  });

  it("drops a review saved before version ids back to idle", async () => {
    const user = await signIn();
    const legacyProposals = [
      {
        changes: [
          {
            at: "2026-01-01T00:00:00.000Z",
            current: "Old text",
            fragment: "New text",
            ref: "abcdefg",
            source: "user",
            type: "revise",
          },
        ],
        id: "proposal-1",
        reason: "Outdated.",
      },
    ];
    await runInDurableObject(
      env.TIDY.getByName(defaultSpace(user.id)),
      async (_instance, state) => {
        await state.storage.put("state", {
          finishedAt: new Date().toISOString(),
          proposals: legacyProposals,
          runId: "run-1",
          status: "ready",
          summary: "Done.",
        });
      }
    );
    await expect(read(user)).resolves.toStrictEqual({ status: "idle" });

    await runInDurableObject(
      env.TIDY.getByName(defaultSpace(user.id)),
      async (_instance, state) => {
        await state.storage.put("state", {
          done: [],
          proposals: legacyProposals,
          runId: "run-2",
          skipped: [],
          status: "applying",
        });
      }
    );
    await expect(read(user)).resolves.toStrictEqual({ status: "idle" });
  });

  it("exports and imports memsys changes with their source", async () => {
    const from = openMemory(crypto.randomUUID());
    await from.remember({ fragment: "No meetings before 10am" }, "system");
    const to = openMemory(crypto.randomUUID());

    const imported = await to.importLog({
      content: await from.exportLog({ history: true }),
      format: "ndjson",
    });
    const { fragments } = await to.readLog({});

    expect(imported.ok).toBeTruthy();
    expect(fragments.map(({ source }) => source)).toStrictEqual(["system"]);
  });
});
