# The in-the-loop benchmark

The harness of [RFC 0006](../../docs/rfcs/0006-in-the-loop-benchmark.md). A generated world is the ground truth, a locked sim user plays the person from a script, and a live agent with memsys serves them session by session. This file has the file layout, the pilot, and the contracts between its parts. The RFC has the design.

## Files

```
eval/loop/
  schema.ts        world.json and script.json, the sim user's turn, and the checks on a script
  check.ts         node eval/loop/check.ts hub/<world>   validates a world and prints its numbers
  accumulate.ts    plays a script against the agent and writes a run
  label.ts         has Jev label which facts every sim user line states, and writes results.md
  hub/             test data, ignored by git
    <world>/world.json, script.json
    runs/<run>/sessions.jsonl, memory.ndjson, run.json, labels.json, results.md
```

## The pilot

One persona, one quarter, one agent, user-side noise only. It answers two questions before anything bigger is built: is the sim user stable, and does the repeat count move with memory on and off.

| Part | Pilot choice |
| --- | --- |
| World | one persona, English, 2026-01-05 to 2026-03-29, about 15 entities, about 40 facts |
| Script | about 60 sessions, half with no fact, all handled by one agent named `assistant` |
| Noise | throwaway remarks, corrections, temporary facts said as permanent, aliases |
| Agent | Pi, `opencode-go/deepseek-v4.1-flash`, memsys through the dev Worker, no other tools |
| Sim user | Pi, `opencode-go/gpt-5.6-luna`, fixed |
| Runs | memory on three times, memory off three times |

Mock apps, a second agent, and probes come after the pilot.

## The world and the script

`schema.ts` is the contract; `check.ts` enforces it. The rules that are not in the types:

- A fact is told in exactly one session. Later sessions list it in `known`. That is what makes a repeat countable: the first `known` after the telling session is the first chance to repeat.
- A fact in `known` must have been told or known in an earlier session; `check.ts` rejects a `known` fact with no earlier exposure, since it could never count as a repeat.
- A fact is told on or after its `from` date. Planning ahead for something that has not started yet is not supported; give such a fact an early `from`.
- `known` holds only facts the goal can plausibly need. The sim user says them only when asked, so a `known` fact the agent never needs is dead weight.
- Half of the sessions have neither `tells` nor `known`. They still have a goal and throwaways.
- An alias on a card means the user calls that entity by the alias for the whole session, and never by its name.
- `background` and `notes` are for the sim user. The agent never sees the world or the script.

## The sim user

The sim user is a model with the card and the dialogue so far. Its rules are fixed and are part of the corpus version:

1. Do not volunteer facts. Say a `known` fact only when the agent asks for it, and then say only that fact.
2. Never invent a name, date, price, or preference that the card does not have. If the agent asks for something the card does not have, say you do not know or that it does not matter.
3. Assume the agent remembers. Do not ask whether it does, and do not confirm what it says unless it is wrong.
4. When the agent states a card fact wrongly, correct it once.
5. Bring up each `tells` fact at a natural point, with its noise: say `wrongFirst` and correct yourself later in the session; say a temporary fact as if it were lasting.
6. Make the `throwaways` at some point, and nothing else that could be taken as a fact about you.
7. Set `done` when `doneWhen` holds or the turn limit is near. Do not end before the `tells` are out.

Every turn returns one JSON object, the `simTurnSchema` in `schema.ts`: `say`, `disclosed` (every fact id from `known` or `tells` that the line states), and `done`. The self-report is not trusted: `label.ts` has Jev read every sim user line, with the agent's line before it, against every fact on the card and decide which facts the line states. Repeats are counted from Jev's labels. Turns where the self-report and the label differ are listed in the results for a hand check; many of them mean the sim user rules or the judge prompt need work.

## Runs

A run plays the script in order. For each session it starts a fresh agent conversation with the system prompt (the harness line and memsys's server instructions, as `eval/longmemeval/write.ts` does), memsys at `/__dev/eval/<run>/mcp` with every tool, and no other tool. The sim user opens with the goal; the two alternate until `done` or 8 sim user turns. Nothing is carried between sessions except memsys. With `--memory off`, memsys is not configured at all.

`sessions.jsonl` has one record per session: the card id, every turn (who, text, `disclosed`), the agent's tool calls, cost, and time. `memory.ndjson` is the memory exported at the end of the script. `labels.json` is Jev's verdict per sim user turn. `results.md` reports, per run:

- **repeats**: sim user lines that state a fact an earlier session exposed, by Jev, with the session and fact ids
- **expected**: the number of `known` facts that an earlier session exposed, the denominator
- **written**: fragments per session, and the total
- **disputed**: turns where the self-report and Jev differ, with both lists, for a hand check
- **cost** and time per session

Compare memory on against memory off on repeats first. If three repeats of one setting spread more than the two settings differ, the sim user is not stable enough and the rules need work before anything else.
