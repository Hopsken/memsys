import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  corpusRecord,
  labels,
  loadCorpus,
  requiredSessions,
} from "./corpus.ts";
import type { Labels } from "./corpus.ts";
import type { SlimQuestion } from "./dataset.ts";
import { CORRECT, jev } from "./jev.ts";
import { currentMemories, readJson, readLines } from "./server.ts";

const { values: args } = parseArgs({
  options: { corpus: { type: "string" } },
});
const NAME = args.corpus;
if (NAME === undefined) {
  throw new Error("Name the corpus: --corpus <name>");
}
const { dir: DIR, questions } = await loadCorpus(NAME);
const LABELS = path.join(DIR, "labels.json");
const known: Labels = existsSync(LABELS) ? await readJson(LABELS, labels) : {};

interface Row {
  candidates: { ref: string; score: number; text: string }[];
  q: SlimQuestion;
  session: SlimQuestion["evidence"][number];
}
const rows: Row[] = [];
const judge = await jev();
try {
  for (const q of questions) {
    // oxlint-disable-next-line no-await-in-loop
    const records = await readLines(
      path.join(DIR, q.id, "memory.ndjson"),
      corpusRecord
    );
    const current = currentMemories(records);
    const labeled = (known[q.id] ??= {});
    for (const session of q.evidence) {
      if (session.turns.length === 0 || labeled[session.index]) {
        continue;
      }
      const refs = [
        ...new Set(
          records
            .filter((r) => r.session === session.index)
            .map((r) => r.ref)
            .filter((ref) => current.has(ref))
        ),
      ];
      const candidates = refs.map((ref) => ({
        ref,
        score: 0,
        text: current.get(ref) ?? "",
      }));
      if (refs.length > 0) {
        // oxlint-disable-next-line no-await-in-loop
        const { scores } = await judge.score(
          Object.fromEntries(
            refs.map((ref) => [
              ref,
              {
                criteria: {
                  false:
                    "The fragment is about something else in the conversation, or drops the detail the question turns on.",
                  true: "The fragment keeps the fact from `evidence` that `question` depends on, even if answering also needs other memories or some reasoning.",
                },
                instructions: `\`evidence\` is one turn of a past conversation. It contains a fact that \`question\` depends on. Does candidates.${ref} preserve that fact?`,
                type: "noul" as const,
              },
            ])
          ),
          {
            candidates: Object.fromEntries(
              candidates.map((c) => [c.ref, c.text])
            ),
            evidence: session.turns
              .map((t) => `${t.role}: ${t.content}`)
              .join("\n\n"),
            question: q.question,
          }
        );
        for (const c of candidates) {
          c.score = scores[c.ref] ?? 0;
        }
      }
      labeled[session.index] = candidates
        .filter((c) => c.score >= CORRECT)
        .map((c) => c.ref);
      rows.push({ candidates, q, session });
    }
    process.stderr.write(`labeled ${q.id}\n`);
  }
} finally {
  await judge.dispose();
}

await writeFile(LABELS, `${JSON.stringify(known, null, 2)}\n`);

const oneLine = (text: string, max: number) => {
  const flat = text.replaceAll(/\s+/gu, " ").replaceAll("|", "\\|").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};
const misses = questions.filter((q) =>
  requiredSessions(q).some((index) => (known[q.id]?.[index] ?? []).length === 0)
);
const review = `# Evidence labels for \`${NAME}\`

${questions.length} questions, ${rows.length} evidence sessions labeled by Jev this run. A fragment is labeled when its score is at least ${CORRECT}; \`labels.json\` holds the result and is the file to correct by hand. Write misses (a required session with no labeled fragment): ${misses.length} (${misses.map((q) => q.id).join(", ") || "none"}).

${rows
  .map(
    ({
      candidates,
      q,
      session,
    }) => `## ${q.id} (${q.type}), session ${session.index} of ${session.date}

**Q:** ${oneLine(q.question, 200)}
**A:** ${oneLine(q.answer, 200)}

Evidence:

${session.turns.map((t) => `> ${t.role}: ${oneLine(t.content, 600)}`).join("\n>\n")}

| Label | Score | Ref | Fragment |
| --- | --- | --- | --- |
${
  candidates
    .map(
      (c) =>
        `| ${c.score >= CORRECT ? "yes" : ""} | ${c.score.toFixed(2)} | ${c.ref} | ${oneLine(c.text, 300)} |`
    )
    .join("\n") || "| | | | nothing written from this session |"
}
`
  )
  .join("\n")}`;
await writeFile(path.join(DIR, "labels-review.md"), review);
process.stdout.write(
  `${NAME}: ${rows.length} sessions labeled, ${misses.length} write misses\n`
);
