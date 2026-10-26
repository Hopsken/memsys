import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  exposedBefore,
  problems,
  scriptSchema,
  worldSchema,
} from "./schema.ts";

// node eval/loop/check.ts <world dir>
// Validates world.json and script.json and prints the numbers that decide
// whether the script can measure anything.

const [dir] = process.argv.slice(2);
if (!dir) {
  throw new Error("usage: check.ts <world dir>");
}
const read = async (file: string) =>
  z.json().parse(JSON.parse(await readFile(path.join(dir, file), "utf-8")));
const world = worldSchema.parse(await read("world.json"));
const script = scriptSchema.parse(await read("script.json"));

const found = problems(world, script);
for (const line of found) {
  process.stdout.write(`${line}\n`);
}

const { sessions } = script;
const withFacts = sessions.filter((s) => s.tells.length + s.known.length > 0);
const expected = sessions.flatMap((s, i) => {
  const before = exposedBefore(sessions, i);
  return s.known.filter((id) => before.has(id));
});
const noise = {
  alias: sessions.filter((s) => Object.keys(s.aliases).length > 0).length,
  "as-permanent": sessions
    .flatMap((s) => s.tells)
    .filter((t) => t.noise === "as-permanent").length,
  correction: sessions
    .flatMap((s) => s.tells)
    .filter((t) => t.noise === "correction").length,
  throwaway: sessions.reduce((n, s) => n + s.throwaways.length, 0),
};
process.stdout.write(
  `${JSON.stringify(
    {
      entities: world.entities.length,
      expectedRemembered: expected.length,
      facts: world.facts.length,
      noise,
      problems: found.length,
      sessions: sessions.length,
      sessionsWithFacts: withFacts.length,
      told: sessions.reduce((n, s) => n + s.tells.length, 0),
    },
    null,
    2
  )}\n`
);
process.exitCode = found.length > 0 ? 1 : 0;
