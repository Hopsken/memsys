# RFC 0006: An in-the-loop benchmark on a synthetic life

- Status: Proposed
- Created: 2026-10-26
- Discussion: [Amp thread](https://ampcode.com/threads/T-01a1773a-4647-7528-adca-9b160f9b64e4)
- Builds on: [RFC 0003](0003-recall-benchmark.md), which stays as the recall-only benchmark

## Summary

memsys gets a second benchmark that measures the whole loop: an agent serves a user over a simulated year, decides what to write as it goes, and later has to act on what it remembers without being told to.

- The material is made by us. A **world** (one person, their contacts, calendar, mail, repositories, and a timeline of facts) is generated once and is the ground truth. Conversations are derived from the world, not the other way round.
- A **locked sim user** talks to a live agent that has memsys and mock apps. The dialogue differs from run to run; the facts do not.
- One user has several agents, with different tools and prompts, that share one memory.
- Memory is accumulated in the loop and exported as snapshots. **Probes** are action tasks that run on a snapshot and are graded on mock tool calls.
- Noise is written into the world and the script with labels, so that each kind can be measured and its amount is a parameter of the corpus.

The benchmark answers "does a change make the agent repeat itself less and act right more often, at what cost to read", on a memory of thousands of fragments.

## Why

RFC 0003 measures recall on LongMemEval and does its job: it says whether a recall change is better than the last one. It cannot say much more.

- A memory space from LongMemEval_S holds a few hundred fragments, and a good model finds every evidence session on dev. The benchmark tells us that a change is not worse. It does not tell us where the system breaks.
- The sessions come from the internet, cleaned. They contradict themselves in ways nobody labeled, so a wrong answer can be the data's fault, and we cannot tell.
- The agent is a bystander. It reads a finished transcript and writes afterwards. Nothing it says changes what the user says next, so the benchmark cannot show what memory does to a decision.

Every public option we looked at has the third problem in some form. LongMemEval and DolphinBench replay user text that was written with no agent present. STATE-Bench is in the loop inside one task and a bystander between tasks. A benchmark that shows memory in a decision has to let the agent's behavior change the dialogue, and that needs a user who reacts. That user has to be simulated. Once the user is simulated, the facts behind the user have to be ours, or there is no ground truth. That is the whole design.

## Terms

- The **world** is the ground truth: the person, their entities with aliases, app records, and a timeline of **facts**. A fact has an id, a statement, the period it applies to, and the fact it supersedes, if any.
- The **script** is the list of sessions. A session card names the date, which agent handles it, the user's goal, what the user knows and says only when asked, which facts the agent is expected to know already, and how the user corrects the agent.
- The **sim user** is a model that plays the person from a session card under fixed rules.
- An **agent** is Pi with a system prompt, a subset of the mock apps, and memsys.
- **Accumulation** is the run that plays the script against the agents and produces the memory.
- A **snapshot** is the memory exported at a point in the script.
- A **probe** is an action task run on a snapshot and graded on tool calls.

## Decisions

### 1. The world comes first, and conversations are derived from it

Free dialogue between two models produces text, not a benchmark: nobody knows which facts it holds, which fact is current, or which session exposed it. So the world is generated first, with the facts, their periods, and their `supersedes` links, and app records are written against it. The script is generated from the world. The user's lines are never generated ahead of time.

The generation pipeline follows DolphinBench's shape (persona, quarter plan, weekly events, app operations replayed in narrative time, a fact registry) and stops before user messages. It uses a strong model, once per world. The world is kept with the corpus, as the LongMemEval sets are.

### 2. The sim user is locked

The sim user gives the benchmark its consequences, so it must not help the agent. Its rules are fixed and are part of the corpus version:

1. Do not volunteer facts. Say what is on the card as "known" only when the agent asks.
2. Never invent names, dates, prices, or preferences that are not on the card.
3. Assume the agent remembers. Do not ask whether it does, and do not confirm.
4. When the agent is wrong about a fact on the card, correct it once. Accept what a tool shows.
5. End the session only when the goal is reached or the turn limit is hit.

Rule 3 is the one STATE-Bench does not have. Without it, polite confirmation counts as repetition and the main metric is noise.

The sim user's model is fixed for a corpus and is not the agent's model.

### 3. One user, several agents, one memory

The primary use case in [VISION](../VISION.md) is a person with several agents that share one memory. The benchmark has at least two agents, such as a daily assistant with mail, calendar, and messages, and a coding agent with repositories and deploys. Each has its own system prompt and its own subset of the mock apps. The script says which agent handles each session. Every agent writes to the same memory space, under its own persona ([RFC 0005](0005-personas.md)), so the log says who wrote what.

Some probes are cross-agent on purpose: the fact is exposed only to one agent and the probe runs on another.

### 4. Mock apps are the world's interface

The agents reach the world only through mock apps: one local MCP server over one JSON state file, as DolphinBench does. Every call is logged with its arguments and result. The apps are deterministic. A tool's result is the only way the agent learns something the user did not say, such as a meeting another person moved.

### 5. Accumulate in the loop, probe on snapshots

Accumulation is the expensive run. It plays the whole script, session by session, with memsys read-write and the mock apps live, and exports a snapshot at the end of each simulated month. The snapshots are kept with the corpus, like a LongMemEval corpus is kept.

Probes run on snapshots with memsys read-only. A change to the write side (server instructions, write tool descriptions, the write check, the agent's model) needs a new accumulation. A change to recall needs only the probes. This is the same split as RFC 0003, for the same reason: 90% of the cost is in writing, and it has to be reused.

The dialogue in accumulation differs between runs. That is intended: what the agent asks and writes is part of what is measured. Runs are compared on the metrics, with repeats, not on the transcripts.

### 6. Probes are actions, and every probe is certified

A probe does not announce that memory is needed. It says "post the rollout update to the right channel", not "which channel do I use for rollouts". Grading checks the mock tool calls: the tool that was called, its arguments, and, for free text, a judge on one field. No call is a fail.

Every probe passes a gate before it enters a set, as in DolphinBench: it must pass when the agent gets the source sessions of its facts in context, and it must fail when memory is off. A probe that fails the first is unsolvable; one that passes the second does not need memory.

Each probe records which facts it depends on and which kinds of noise touch them, so that results can be grouped by both.

### 7. Noise is labeled and is a corpus parameter

A model-written life is cleaner than a real one. The benchmark adds the mess on purpose, but every piece of it is a field in the world or on a session card with the true fact next to it. Nothing is left for the model to improvise, because improvised noise has no ground truth.

| Kind | Where it lives | What it tests | Default |
| --- | --- | --- | --- |
| Sessions with no fact | script | distractor volume | 50% of sessions |
| Throwaway remarks | session card | what not to write | 1 to 2 per session |
| Corrections mid-session | session card | `revise`, last value wins | 10% of facts |
| Temporary said like a preference | fact period | temporary stored as permanent | 15% of preferences |
| Aliases | entities | cues that miss the stored name | 30% of mentions |
| User wrong, tool right | session card | which source the agent trusts | 5% of fact mentions |
| Silent changes in the world | app state | stale memory used | 10% of facts |
| Near-duplicate entities | entities | wrong match | 1 per key entity |
| One fact in several wordings | script | duplicates, `truncated` | 20% of facts |

These defaults are a starting point. The rule for tuning them: the baseline should land well below the ceiling and well above the no-memory control. If the baseline scores like LongMemEval, raise the noise; if it scores like no memory, lower it. A different setting is a different corpus, recorded in its `corpus.json`.

### 8. Metrics

Primary, both scripted and without a judge:

- **Repeats.** During accumulation, each time the sim user says a "known" item that an earlier session already exposed. This is VISION's "how often do I repeat myself".
- **Probe pass**, as pass@1 and pass^3, grouped by agent, by fact kind, and by noise kind.

Secondary, from the logs:

- **Stale**: probes and sessions where the agent used a superseded value.
- **Read**: fragments and tokens returned per probe, and recall rounds, as in RFC 0003.
- **Written**: fragments per session, and fragments written from throwaway remarks.
- **Cost** per session and per probe, write side included.

Two controls run on every corpus: **no memory** (memsys off) and **oracle** (the source sessions in context). The gap between them is what memory can win; where the baseline sits in that gap is the score.

### 9. What is under test

Everything between the agent and the memory: the server instructions, the five tool descriptions, recall, and the write check. The agent harness is Pi, for the reasons in RFC 0003. The agent model, the sim user model, and the judge model are parameters, fixed per corpus and never the same model for the sim user and the agent.

## Sets and cost

One world is one persona over one to two simulated years, about 600 sessions a year, which is a few thousand fragments. A second world is wanted as holdout, but a world is the most expensive artifact here, so the second waits until the first has shown it measures something.

Rough costs with a cheap agent model, to be replaced by measured ones after the pilot: world generation $10 to $20 once, accumulation under $10 per simulated year, probes 200 tasks with three repeats about $5. Test data lives in the Hugging Face dataset, as RFC 0003 decided.

## Not in this RFC

- The world generation prompts, the session card schema, the mock app tool list, and the probe check language. They are decided while building and documented in `eval/`.
- A stress corpus with higher noise. It is a second corpus, not a design change.
- Probes during accumulation, interleaved with sessions. Snapshots make this possible later without a new world.
- Dreaming or any memory maintenance. When it exists, it runs between snapshots and is measured by the same probes.

## Alternatives considered

### Replay a prepared user transcript

Rejected. The user text is the same whatever the agent does, so the agent's reply changes nothing and the memory cannot be seen in a decision. This is what LongMemEval and DolphinBench do, and it is the reason they cannot be reused here.

### Let two models talk and keep the transcript as the corpus

Rejected. It produces text with no fact registry, so probes cannot be certified and noise cannot be labeled. The world has to come first.

### Run DolphinBench or STATE-Bench as they are

Set aside. DolphinBench is replay with a one-message-per-session history. STATE-Bench is bystander between tasks, its memory is read-only at test, and a static prompt can top its leaderboard. Both are useful as one-time outside references, not as the iteration loop. Their mechanics are borrowed: DolphinBench's world-first generation, mock apps, and certification gate; STATE-Bench's locked sim user.

### Probe only, with no accumulation

Rejected. It would be RFC 0003 on a bigger corpus. The write side, and the agent's decision to recall, are what this benchmark adds.

## Open questions

The pilot decides these: one persona, one quarter of about 60 sessions, one agent, and only the four user-side noise kinds (throwaway remarks, corrections, temporary preferences, aliases).

- Is the sim user stable enough that repeats differ between memory settings more than between repeats of the same setting.
- Does the repeat count move at all with memory on and off.
- The real cost per session and per probe.
- How many probes a quarter can support after the certification gate.

## Decision

Build the pilot as described in Open questions. If repeats and probe pass separate memory on from memory off, build the first full world and land the harness in `eval/` next to the LongMemEval one.
