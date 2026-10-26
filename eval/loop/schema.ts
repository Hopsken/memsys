import { z } from "zod";

import { piRunSchema } from "../longmemeval/pi.ts";

// The world and the script of the in-the-loop benchmark, RFC 0006.
// The world is the ground truth. The script says what the sim user knows
// and wants in each session. Neither holds any user text: the sim user
// speaks from the card at run time.

const idSchema = z.string().regex(/^[a-z][a-z0-9-]*$/u);
const dateSchema = z.iso.date();

export const entitySchema = z.object({
  // Other names the user uses for it: a nickname, a role, a short form.
  aliases: z.array(z.string()),
  id: idSchema,
  kind: z.enum(["person", "place", "org", "project", "thing"]),
  name: z.string(),
  // For the generator and the sim user, never shown to the agent.
  notes: z.string(),
});
export type Entity = z.infer<typeof entitySchema>;

export const factSchema = z.object({
  // First day the fact holds.
  from: dateSchema,
  id: idSchema,
  kind: z.enum(["preference", "world", "episode"]),
  // The truth, as one plain sentence.
  statement: z.string(),
  subjects: z.array(idSchema),
  // The fact this one replaces, when the value changed.
  supersedes: idSchema.optional(),
  // Last day the fact holds. Set on temporary facts; open otherwise.
  until: dateSchema.optional(),
});
export type Fact = z.infer<typeof factSchema>;

export const personaSchema = z.object({
  city: z.string(),
  language: z.string(),
  name: z.string(),
  summary: z.string(),
  timezone: z.string(),
  // How the person talks, a few short examples.
  voice: z.array(z.string()),
});

export const worldSchema = z.object({
  entities: z.array(entitySchema),
  facts: z.array(factSchema),
  period: z.object({ from: dateSchema, to: dateSchema }),
  persona: personaSchema,
});
export type World = z.infer<typeof worldSchema>;

// A fact the user brings up on their own in a session, with the noise it
// comes wrapped in, if any.
export const tellSchema = z.object({
  fact: idSchema,
  // correction: the user first says `wrongFirst`, then corrects it in the
  // same session. as-permanent: a temporary fact said like a lasting one.
  noise: z.enum(["correction", "as-permanent"]).optional(),
  wrongFirst: z.string().optional(),
});
export type Tell = z.infer<typeof tellSchema>;

export const sessionCardSchema = z.object({
  agent: z.string(),
  // Entities the user calls by an alias in this session, by entity id.
  aliases: z.record(idSchema, z.string()).default({}),
  // What is going on for the user today. Hidden narrative for the sim user.
  background: z.string(),
  date: dateSchema,
  // When the user considers the goal reached.
  doneWhen: z.string(),
  // What the user wants from this session. The sim user opens with it.
  goal: z.string(),
  id: idSchema,
  // Facts the user says only when the agent asks.
  known: z.array(idSchema),
  tells: z.array(tellSchema),
  // Remarks worth nothing: small talk, mood, an aside. Not facts.
  throwaways: z.array(z.string()),
});
export type SessionCard = z.infer<typeof sessionCardSchema>;

export const scriptSchema = z.object({
  sessions: z.array(sessionCardSchema),
});
export type Script = z.infer<typeof scriptSchema>;

// What the sim user returns on every turn. `disclosed` is how repeats are
// counted without a judge, so it must list every fact id the line states,
// from `known` or from `tells`.
export const simTurnSchema = z.object({
  disclosed: z.array(idSchema),
  done: z.boolean(),
  say: z.string(),
});
export type SimTurn = z.infer<typeof simTurnSchema>;

// One session of a run, as accumulate.ts writes it to sessions.jsonl: the
// sim user's turns with their self-report, and the agent's with its tools.
const userTurnSchema = simTurnSchema.extend({
  attempts: z.number(),
  cost: z.number(),
  who: z.literal("user"),
});
const agentTurnSchema = piRunSchema
  .omit({ answer: true })
  .extend({ say: z.string(), who: z.literal("agent") });
const turnSchema = z.discriminatedUnion("who", [
  userTurnSchema,
  agentTurnSchema,
]);
export type Turn = z.infer<typeof turnSchema>;
export const sessionLogSchema = z.object({
  cost: z.number(),
  date: z.string(),
  end: z.number(),
  id: z.string(),
  start: z.number(),
  turns: z.array(turnSchema),
});
export type SessionLog = z.infer<typeof sessionLogSchema>;

// A fact that an earlier session exposed, told or disclosed, is one the
// agent is expected to remember. Saying it again is a repeat.
export const exposedBefore = (sessions: SessionCard[], index: number) =>
  new Set(
    sessions
      .slice(0, index)
      .flatMap((s) => [...s.tells.map((t) => t.fact), ...s.known])
  );

const duplicates = (ids: string[], what: string) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      out.push(`${what} ${id} is defined twice`);
    }
    seen.add(id);
  }
  return out;
};

const factProblems = (world: World) => {
  const out: string[] = [];
  const entities = new Set(world.entities.map((e) => e.id));
  const facts = new Map(world.facts.map((f) => [f.id, f]));
  for (const f of world.facts) {
    for (const s of f.subjects) {
      if (!entities.has(s)) {
        out.push(`fact ${f.id}: unknown subject ${s}`);
      }
    }
    const old = f.supersedes && facts.get(f.supersedes);
    if (f.supersedes && !old) {
      out.push(`fact ${f.id}: supersedes unknown ${f.supersedes}`);
    } else if (old && old.from >= f.from) {
      out.push(`fact ${f.id}: supersedes ${old.id} which is not earlier`);
    }
    if (f.until && f.until < f.from) {
      out.push(`fact ${f.id}: until before from`);
    }
  }
  return out;
};

const tellProblems = (
  s: SessionCard,
  facts: Map<string, Fact>,
  told: Map<string, string>
) => {
  const out: string[] = [];
  for (const t of s.tells) {
    const f = facts.get(t.fact);
    if (!f) {
      out.push(`session ${s.id}: tells unknown fact ${t.fact}`);
      continue;
    }
    if (f.from > s.date) {
      out.push(`session ${s.id}: tells ${f.id} before it holds`);
    }
    const earlier = told.get(f.id);
    if (earlier !== undefined) {
      out.push(`session ${s.id}: ${f.id} was already told in ${earlier}`);
    }
    told.set(f.id, s.id);
    if (t.noise === "correction" && !t.wrongFirst) {
      out.push(`session ${s.id}: correction of ${f.id} has no wrongFirst`);
    }
    if (t.noise === "as-permanent" && !f.until) {
      out.push(
        `session ${s.id}: ${f.id} is said as permanent but is not temporary`
      );
    }
  }
  return out;
};

const knownProblems = (
  s: SessionCard,
  facts: Map<string, Fact>,
  exposed: Set<string>
) =>
  s.known.flatMap((id) => {
    const f = facts.get(id);
    if (!f) {
      return [`session ${s.id}: knows unknown fact ${id}`];
    }
    if (f.from > s.date) {
      return [`session ${s.id}: knows ${id} before it holds`];
    }
    if (!exposed.has(id)) {
      return [
        `session ${s.id}: knows ${id}, which no earlier session exposed; add it to tells or to an earlier session`,
      ];
    }
    return [];
  });

const sessionProblems = (world: World, script: Script) => {
  const out: string[] = [];
  const entities = new Set(world.entities.map((e) => e.id));
  const facts = new Map(world.facts.map((f) => [f.id, f]));
  const told = new Map<string, string>();
  let last = "";
  for (const [index, s] of script.sessions.entries()) {
    if (s.date < last) {
      out.push(`session ${s.id}: out of date order`);
    }
    last = s.date;
    if (s.date < world.period.from || s.date > world.period.to) {
      out.push(`session ${s.id}: outside the world's period`);
    }
    out.push(...tellProblems(s, facts, told));
    const exposed = new Set([
      ...exposedBefore(script.sessions, index),
      ...told.keys(),
    ]);
    out.push(...knownProblems(s, facts, exposed));
    for (const id of Object.keys(s.aliases)) {
      if (!entities.has(id)) {
        out.push(`session ${s.id}: alias for unknown entity ${id}`);
      }
    }
  }
  return out;
};

export const problems = (world: World, script: Script): string[] => [
  ...duplicates(
    world.entities.map((e) => e.id),
    "entity"
  ),
  ...duplicates(
    world.facts.map((f) => f.id),
    "fact"
  ),
  ...duplicates(
    script.sessions.map((s) => s.id),
    "session"
  ),
  ...factProblems(world),
  ...sessionProblems(world, script),
];
