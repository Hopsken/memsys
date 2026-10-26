import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { CORRECT, jev } from "../longmemeval/jev.ts";
import { readJson, readLines } from "../longmemeval/server.ts";
import {
  exposedBefore,
  scriptSchema,
  sessionLogSchema,
  worldSchema,
} from "./schema.ts";
import type { SessionCard, SessionLog, Turn } from "./schema.ts";

// node eval/loop/label.ts --run <run>
// Has Jev decide which card facts every sim user line states, independent
// of the sim user's own `disclosed`, and writes labels.json and results.md.
// Rerunning only labels turns that labels.json does not have yet.

const { values: args } = parseArgs({
  options: { run: { type: "string" } },
});
if (!args.run) {
  throw new Error("usage: label.ts --run <run>");
}
const HUB = path.join(import.meta.dirname, "hub");
const RUN_DIR = path.join(HUB, "runs", args.run);
const runSchema = z.looseObject({
  agent: z.string(),
  cost: z.number(),
  memory: z.enum(["on", "off"]),
  sim: z.string(),
  world: z.string(),
});
const meta = await readJson(path.join(RUN_DIR, "run.json"), runSchema);
const WORLD_DIR = path.join(HUB, meta.world);
const world = await readJson(path.join(WORLD_DIR, "world.json"), worldSchema);
const script = await readJson(
  path.join(WORLD_DIR, "script.json"),
  scriptSchema
);
const sessions = await readLines(
  path.join(RUN_DIR, "sessions.jsonl"),
  sessionLogSchema
);

// labels[session id][user turn index] = fact ids Jev says the line states.
const labelsSchema = z.record(
  z.string(),
  z.record(z.string(), z.array(z.string()))
);
const LABELS = path.join(RUN_DIR, "labels.json");
const labels = existsSync(LABELS) ? await readJson(LABELS, labelsSchema) : {};

const facts = new Map(world.facts.map((f) => [f.id, f]));
const entities = new Map(world.entities.map((e) => [e.id, e]));
const cards = new Map(script.sessions.map((s) => [s.id, s]));

// Who the facts are about, with every name the user may use for them, so
// that "she lives in Lisbon" can be matched to "Mei lives in Lisbon".
const whoText = (card: SessionCard, ids: string[]) =>
  [...new Set(ids.flatMap((id) => facts.get(id)?.subjects ?? []))]
    .map((id) => {
      const e = entities.get(id);
      if (!e) {
        return "";
      }
      const names = [...e.aliases, card.aliases[id]].filter(Boolean);
      return `${e.name} (${e.notes}); the user also says: ${names.join(", ") || "nothing else"}`;
    })
    .filter(Boolean)
    .join("\n");
const onCard = (card: SessionCard) => [
  ...new Set([...card.known, ...card.tells.map((t) => t.fact)]),
];

const userTurns = (log: SessionLog) =>
  log.turns.flatMap((turn, index) =>
    turn.who === "user" ? [{ index, turn }] : []
  );

const judge = await jev();
try {
  for (const log of sessions) {
    const card = cards.get(log.id);
    if (!card) {
      throw new Error(`session ${log.id} is not in the script`);
    }
    const candidates = onCard(card);
    const labeled = (labels[log.id] ??= {});
    for (const { index, turn } of userTurns(log)) {
      if (candidates.length === 0 || labeled[index]) {
        labeled[index] ??= [];
        continue;
      }
      const before = log.turns[index - 1];
      // oxlint-disable-next-line no-await-in-loop
      const { scores } = await judge.score(
        Object.fromEntries(
          candidates.map((id) => [
            id,
            {
              criteria: {
                false:
                  "The line does not give the fact. Mentioning the same person, place, or thing in another role is not stating the fact: a dinner in Lisbon does not state that someone lives in Lisbon. Hinting at it, or answering only yes or no to something the assistant said, does not count either.",
                true: "The line states the fact itself, in any wording or with any name the user uses for the subject, or confirms it in a way that supplies the fact's content. A line that states the fact with a mistake that the user later corrects still counts.",
              },
              instructions: `\`line\` is one message from the user to their assistant; \`before\` is what the assistant said just before it; \`who\` names the people and things the facts are about and what the user calls them. Does \`line\` state facts.${id}?`,
              type: "noul" as const,
            },
          ])
        ),
        {
          before: before?.say ?? "",
          facts: Object.fromEntries(
            candidates.map((id) => [id, facts.get(id)?.statement ?? ""])
          ),
          line: turn.say,
          who: whoText(card, candidates),
        }
      );
      labeled[index] = candidates.filter((id) => (scores[id] ?? 0) >= CORRECT);
    }
    process.stderr.write(`labeled ${log.id}\n`);
  }
} finally {
  await judge.dispose();
}
await writeFile(LABELS, `${JSON.stringify(labels, null, 2)}\n`);

// Results

const order = new Map(script.sessions.map((s, i) => [s.id, i]));
const played = sessions.toSorted(
  (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
);
const READ = new Set(["list_tags", "recall"]);
const isWrite = (t: { name: string }) => !READ.has(t.name);

interface Repeat {
  fact: string;
  session: string;
  turn: number;
}
const repeats: Repeat[] = [];
const disputed: {
  jev: string[];
  self: string[];
  session: string;
  turn: number;
}[] = [];
let expected = 0;
for (const log of played) {
  const index = order.get(log.id) ?? 0;
  const before = exposedBefore(script.sessions, index);
  const card = cards.get(log.id);
  expected += (card?.known ?? []).filter((id) => before.has(id)).length;
  for (const { index: turn, turn: t } of userTurns(log)) {
    const jevSaid = labels[log.id]?.[turn] ?? [];
    const self = t.disclosed.toSorted();
    const byJev = jevSaid.toSorted();
    if (self.join(",") !== byJev.join(",")) {
      disputed.push({ jev: byJev, self, session: log.id, turn });
    }
    for (const fact of byJev) {
      if (before.has(fact)) {
        repeats.push({ fact, session: log.id, turn });
      }
    }
  }
}
const writes = played.map((log) => ({
  id: log.id,
  n: log.turns
    .filter((t): t is Turn & { who: "agent" } => t.who === "agent")
    .flatMap((t) => t.tools)
    .filter(isWrite).length,
}));
const totalWrites = writes.reduce((n, w) => n + w.n, 0);
const cost = played.reduce((n, s) => n + s.cost, 0);
const seconds = played.reduce((n, s) => n + (s.end - s.start) / 1000, 0);
const oneLine = (text: string, max: number) => {
  const flat = text.replaceAll(/\s+/gu, " ").replaceAll("|", "\\|").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};
const lineOf = (session: string, turn: number) =>
  oneLine(played.find((s) => s.id === session)?.turns[turn]?.say ?? "", 160);

const results = `# \`${args.run}\`

World \`${meta.world}\`, memory **${meta.memory}**, agent \`${meta.agent}\`, sim user \`${meta.sim}\`. ${played.length} sessions, $${cost.toFixed(3)}, ${Math.round(seconds / 60)} min. Facts stated per line by Jev; the sim user's own \`disclosed\` only for the disputed list.

| | |
| --- | --- |
| repeats | **${repeats.length}** of ${expected} expected |
| written | ${totalWrites} fragments (${(totalWrites / Math.max(played.length, 1)).toFixed(1)} per session) |
| disputed | ${disputed.length} of ${played.reduce((n, s) => n + userTurns(s).length, 0)} sim user turns |
| cost | $${(cost / Math.max(played.length, 1)).toFixed(3)} per session |

## Repeats

A sim user line that states a fact an earlier session already exposed.

| Session | Turn | Fact | Line |
| --- | --- | --- | --- |
${repeats.map((r) => `| ${r.session} | ${r.turn} | ${r.fact} | ${lineOf(r.session, r.turn)} |`).join("\n") || "| none | | | |"}

## Disputed

Turns where the sim user's \`disclosed\` and Jev's label differ. Check by hand; many of these mean the sim user rules or the judge prompt need work.

| Session | Turn | Self | Jev | Line |
| --- | --- | --- | --- | --- |
${disputed.map((d) => `| ${d.session} | ${d.turn} | ${d.self.join(", ") || "-"} | ${d.jev.join(", ") || "-"} | ${lineOf(d.session, d.turn)} |`).join("\n") || "| none | | | | |"}

## Writes per session

${writes.map((w) => `${w.id}: ${w.n}`).join(", ")}
`;
await writeFile(path.join(RUN_DIR, "results.md"), results);
process.stderr.write(
  `repeats ${repeats.length}/${expected}, disputed ${disputed.length}, written ${totalWrites}\n`
);
