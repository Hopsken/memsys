import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { HARNESS } from "../longmemeval/corpus.ts";
import { runPi } from "../longmemeval/pi.ts";
import {
  exportLog,
  readJson,
  readLines,
  SERVER,
  serverInstructions,
} from "../longmemeval/server.ts";
import {
  problems,
  scriptSchema,
  sessionLogSchema,
  simTurnSchema,
  worldSchema,
} from "./schema.ts";
import type { Fact, SessionCard, SessionLog, SimTurn, Turn } from "./schema.ts";

// node eval/loop/accumulate.ts --world <world> --run <run> --memory on|off
// Plays the script of a world against the agent, session by session, with
// the sim user on the other side. Resumes a run from sessions.jsonl.

const { values: args } = parseArgs({
  options: {
    agent: { default: "opencode-go/deepseek-v4.1-flash", type: "string" },
    memory: { type: "string" },
    only: { type: "string" },
    run: { type: "string" },
    sim: { default: "opencode-go/gpt-5.6-luna", type: "string" },
    "sim-thinking": { default: "medium", type: "string" },
    thinking: { default: "low", type: "string" },
    turns: { default: "8", type: "string" },
    world: { type: "string" },
  },
});
const memory = z.enum(["on", "off"]).parse(args.memory);
if (!args.world || !args.run) {
  throw new Error(
    "usage: accumulate.ts --world <world> --run <run> --memory on|off"
  );
}
const HUB = path.join(import.meta.dirname, "hub");
const WORLD_DIR = path.join(HUB, args.world);
const RUN_DIR = path.join(HUB, "runs", args.run);
const SPACE = `loop-${args.run}`;
const MAX_TURNS = Number(args.turns);

const world = await readJson(path.join(WORLD_DIR, "world.json"), worldSchema);
const script = await readJson(
  path.join(WORLD_DIR, "script.json"),
  scriptSchema
);
const found = problems(world, script);
if (found.length > 0) {
  throw new Error(
    `the world has problems; run check.ts first:\n${found.join("\n")}`
  );
}

// The sim user's rules. They are part of the corpus version: a change here
// changes what every run measures.
const SIM_RULES = `You play a real person talking to their personal assistant in a chat. You get a card: who you are, what you want today, and the facts you may state. Stay in character and write like the person, in short chat messages.

Rules:
1. Do not volunteer facts. Say a fact from "Known" only when the assistant asks for it, and then say only that fact.
2. Never invent a name, date, price, place, or preference that the card does not have. If the assistant asks for something the card does not have, say you do not know, or that it does not matter.
3. Assume the assistant remembers earlier conversations. Do not ask whether it remembers, and do not confirm what it says unless it is wrong.
4. When the assistant states a card fact wrongly, correct it once.
5. Bring up each fact in "Tell" at a natural point. If it has "say wrongly first", say the wrong version first and correct yourself later in the session as if you had misspoken. If it is marked "say as if lasting", state it as a standing fact, without the end date.
6. Make the "Throwaways" at some point. Say nothing else that could be taken as a fact about you.
7. Set "done" to true when "Done when" holds or the turn limit is near. Do not end before every "Tell" fact is out. When done, "say" is your closing line.

Reply with one JSON object and nothing else:
{"say": "<your next message>", "disclosed": ["<fact id>", ...], "done": <true|false>}
"disclosed" lists the id of every card fact that your message states, from "Known" or "Tell". A message that states no card fact has an empty list.`;

const factLine = (f: Fact, note = "") => `- ${f.id}: ${f.statement}${note}`;

const cardText = (card: SessionCard, turn: number) => {
  const facts = new Map(world.facts.map((f) => [f.id, f]));
  const fact = (id: string) => {
    const f = facts.get(id);
    if (!f) {
      throw new Error(`unknown fact ${id}`);
    }
    return f;
  };
  const tells = card.tells.map((t) => {
    const f = fact(t.fact);
    if (t.noise === "correction") {
      return factLine(f, ` (say wrongly first: "${t.wrongFirst ?? ""}")`);
    }
    if (t.noise === "as-permanent") {
      return factLine(f, " (say as if lasting)");
    }
    return factLine(f);
  });
  const aliases = Object.entries(card.aliases).map(([id, alias]) => {
    const e = world.entities.find((entity) => entity.id === id);
    return `- call ${e?.name ?? id} "${alias}" the whole time, never by the name`;
  });
  const { persona } = world;
  return [
    `You are ${persona.name}, ${persona.summary} You live in ${persona.city} and write in ${persona.language}.`,
    `How you write: ${persona.voice.join(" / ")}`,
    `Today: ${card.date}. Turn ${turn} of at most ${MAX_TURNS}.`,
    `Goal: ${card.goal}`,
    `Done when: ${card.doneWhen}`,
    `Background (for you only): ${card.background}`,
    `Tell (bring these up yourself):\n${tells.join("\n") || "- nothing"}`,
    `Known (only if asked):\n${card.known.map((id) => factLine(fact(id))).join("\n") || "- nothing"}`,
    `Throwaways:\n${card.throwaways.map((t) => `- ${t}`).join("\n") || "- nothing"}`,
    aliases.length > 0 ? `Names:\n${aliases.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

const transcript = (turns: Turn[]) =>
  turns
    .map((t) => `${t.who === "user" ? "You" : "Assistant"}: ${t.say}`)
    .join("\n\n");

const parseSimTurn = (answer: string): SimTurn | undefined => {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start === -1 || end < start) {
    return undefined;
  }
  const parsed = simTurnSchema.safeParse(
    z.json().parse(JSON.parse(answer.slice(start, end + 1)))
  );
  return parsed.success ? parsed.data : undefined;
};

const SIM_ATTEMPTS = 3;

const simTurn = async (card: SessionCard, turns: Turn[], dir: string) => {
  const onCard = new Set([...card.known, ...card.tells.map((t) => t.fact)]);
  const userTurns = turns.filter((t) => t.who === "user").length + 1;
  const prompt =
    turns.length === 0
      ? "The conversation has not started. Write your first message to the assistant."
      : `The conversation so far:\n\n${transcript(turns)}\n\nWrite your next message to the assistant.`;
  let cost = 0;
  for (let attempt = 1; attempt <= SIM_ATTEMPTS; attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop
    const run = await runPi({
      dir,
      model: args.sim,
      prompt,
      stdin: "",
      system: `${SIM_RULES}\n\n${cardText(card, userTurns)}`,
      systemMode: "replace",
      thinking: args["sim-thinking"],
    });
    cost += run.cost;
    const parsed =
      run.error === undefined ? parseSimTurn(run.answer) : undefined;
    if (parsed) {
      return {
        ...parsed,
        attempts: attempt,
        cost,
        disclosed: parsed.disclosed.filter((id) => onCard.has(id)),
        who: "user" as const,
      };
    }
  }
  throw new Error(`sim user gave no valid turn for ${card.id}`);
};

const NO_MEMORY_HARNESS =
  "You are the user's personal assistant across many separate conversations. Nothing carries over between conversations.";

const agentSystem = (instructions: string, date: string) =>
  memory === "on"
    ? `${HARNESS}\n\n${instructions}\n\nToday is ${date}.`
    : `${NO_MEMORY_HARNESS}\n\nToday is ${date}.`;

const playSession = async (
  card: SessionCard,
  instructions: string
): Promise<SessionLog> => {
  const start = Date.now();
  const turns: Turn[] = [];
  const piDir = path.join(RUN_DIR, ".pi");
  for (let i = 0; i < MAX_TURNS; i += 1) {
    // oxlint-disable-next-line no-await-in-loop
    const user = await simTurn(card, turns, path.join(piDir, "sim"));
    turns.push(user);
    if (user.say.trim() === "") {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop
    const agent = await runPi({
      dir: path.join(piDir, "agent"),
      ...(memory === "on" && { mcpUrl: `${SERVER}/__dev/eval/${SPACE}/mcp` }),
      model: args.agent,
      prompt: user.say,
      sessionDir: path.join(piDir, "sessions", card.id),
      stdin: "",
      system: agentSystem(instructions, card.date),
      systemMode: "replace",
      thinking: args.thinking,
    });
    if (agent.error !== undefined) {
      throw new Error(`agent failed in ${card.id}: ${agent.error}`);
    }
    const { answer, ...rest } = agent;
    turns.push({ ...rest, say: answer, who: "agent" });
    if (user.done) {
      break;
    }
  }
  return {
    cost: turns.reduce((n, t) => n + t.cost, 0),
    date: card.date,
    end: Date.now(),
    id: card.id,
    start,
    turns,
  };
};

const SESSIONS = path.join(RUN_DIR, "sessions.jsonl");
await mkdir(RUN_DIR, { recursive: true });
const logged = await readLines(SESSIONS, sessionLogSchema);
if (logged.length === 0 && memory === "on") {
  const existing = await exportLog(SPACE);
  if (existing.length > 0) {
    throw new Error(`memory space ${SPACE} is not empty; pick a new run name`);
  }
}
const done = new Set(logged.map((s) => s.id));
const only = new Set(args.only?.split(","));
const instructions = memory === "on" ? await serverInstructions() : "";
const cards = script.sessions.filter(
  (s) => !done.has(s.id) && (only.size === 0 || only.has(s.id))
);
for (const card of cards) {
  // oxlint-disable-next-line no-await-in-loop
  const log = await playSession(card, instructions);
  // oxlint-disable-next-line no-await-in-loop
  await appendFile(SESSIONS, `${JSON.stringify(log)}\n`);
  const written = log.turns
    .filter((t) => t.who === "agent")
    .flatMap((t) => t.tools)
    .filter((t) => t.name !== "recall" && t.name !== "list_tags").length;
  process.stderr.write(
    `${card.id} ${card.date}: ${log.turns.length} turns, ${written} writes, $${log.cost.toFixed(3)}, ${Math.round((log.end - log.start) / 1000)}s\n`
  );
}

if (memory === "on") {
  const records = await exportLog(SPACE);
  await writeFile(
    path.join(RUN_DIR, "memory.ndjson"),
    records.map((r) => `${JSON.stringify(r)}\n`).join("")
  );
}
const all = await readLines(SESSIONS, sessionLogSchema);
await writeFile(
  path.join(RUN_DIR, "run.json"),
  `${JSON.stringify(
    {
      agent: args.agent,
      cost: all.reduce((n, s) => n + s.cost, 0),
      memory,
      run: args.run,
      sessions: all.length,
      sim: args.sim,
      simThinking: args["sim-thinking"],
      space: SPACE,
      thinking: args.thinking,
      turns: MAX_TURNS,
      world: args.world,
    },
    null,
    2
  )}\n`
);
process.stderr.write(
  `${all.length} sessions, $${all.reduce((n, s) => n + s.cost, 0).toFixed(3)}; label with: node eval/loop/label.ts --run ${args.run}\n`
);
