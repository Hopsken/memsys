# RFC 0003: A benchmark for recall alone

- Status: Proposed
- Created: 2026-10-22
- Discussion: [Amp thread](https://ampcode.com/threads/T-01a16128-22a6-71f2-9eb1-df4bdcfc0364)
- Implementation: lands with this RFC, in `eval/longmemeval/`. It replaces the whole-system harness on branch `eval/longmemeval-baseline`, whose run `baseline-1021` stays there.

## Summary

memsys gets a benchmark that measures one thing: given a memory that is already written, how well does recall bring back what the question needs, and how much does the agent have to read and how many times does it have to ask to get there.

- The material is LongMemEval_S. One question is one memory space.
- Building the memory (the **write phase**) is done once per writer version and the result is kept, so that every recall experiment reuses it. Corpora live in a Hugging Face dataset repo; the Git repo keeps a manifest and the small files.
- Measuring recall (the **recall phase**) runs a cheap agent with only two read-only tools, `list_tags` and `recall`, and at most 5 recall rounds per question.
- Each question reports: was every piece of evidence found, how many fragments were read, how many rounds it took, and how much of what came back was noise.
- Four nested sets, smoke (12), dev (60), holdout (60), full (500), keep everyday iteration cheap and keep the final number honest.

The benchmark answers "is this recall better than the last one", not "is memsys useful". That larger question stays with the whole-system eval in `eval/longmemeval/`, and with a future in-the-loop eval.

## Why recall alone

Every memory benchmark we looked at has one of two problems.

- **It is really a search benchmark.** A bystander reads a finished history, a question is asked, and the score is whether the right passage comes back. On that test a mature passage search is hard to beat, and a memory system looks like a worse search engine. That is the finding of Memory Arena and it matches our own full-context control, which ties memsys on LongMemEval_S.
- **It is really a harness and model benchmark.** Task-completion scores move with the model, the prompt, and the agent loop as much as with the memory. Two runs of the same memory can land far apart, so the memory's contribution is hard to see.

memsys is used in the loop: an agent writes as it goes and the memory keeps changing. No public benchmark measures that, and building one is a large project. But one part of the system has a stable, objective measure today: recall. If a recall change brings back more of what was needed, or brings it back with less to read and in fewer tries, the change is good for every agent that uses memsys. So this RFC scopes the benchmark to recall and leaves the rest for later.

## The question each run answers

For a change to recall (ranking, filtering, association, the tool's description, the cue policy, or a different engine behind the same interface), the run says whether the change:

1. finds at least as much of the evidence as before,
2. with fewer fragments read, or
3. in fewer rounds.

A change that loses evidence is bad however little it reads. A change that reads less at the same evidence is good. A change that reads more at the same evidence has to argue for itself.

## Material

[LongMemEval_S](https://github.com/xiaowu0162/LongMemEval), the cleaned release, 500 questions in six types: single-session-user, single-session-assistant, single-session-preference, multi-session, temporal-reasoning, knowledge-update, plus the abstention variants of each.

Each question comes with its own history of about 50 sessions. The history is not one person's: the paper's appendix A.2 says it mixes 25% ShareGPT, 25% UltraChat, and 50% simulated sessions of other personas, all under the name "User". For a recall benchmark this is fine, and even useful: the other sessions are distractors. Three things follow from it.

- One question is one memory space. Spaces are never merged: names such as "friend Rachel" recur across histories with different facts.
- These spaces are not a real person's memory and must not be reused for an in-the-loop eval.
- The dataset gives, for each question, which sessions hold the answer (`answer_session_ids`) and which turns in them (`has_answer`). That is the ground truth below.

Question types are all kept for now. Some types mean less for memsys (single-session-user is close to a search test; single-session-assistant depends on whether the writer stored what the assistant produced), but pruning by type is shelved until the first runs show which types tell us nothing.

## Sets

Four nested sets, sampled by seed from the 500. Everyday iteration uses the small ones; the big ones are for confirmation.

| Set | Size | Composition | Use |
| --- | --- | --- | --- |
| smoke | 12 | 2 per type, a subset of dev | After every change, before anything else |
| dev | 60 | 10 per type, fixed seed | Deciding whether a change is kept; paired comparison against the last run |
| holdout | 60 | 10 per type, a different seed, disjoint from dev | Run once when a set of changes feels done. Never tuned on, never looked at |
| full | 500 | Everything | Rare. A number to publish |

The current `sample()` in `dataset.ts` orders questions by a hash of their id, which is a fixed seed. It gets a `seed` parameter so that holdout can be drawn from a different order while staying reproducible.

The point of holdout is not sampling bias but tuning bias: after enough changes judged on dev, recall is good at dev. Holdout tells us how much of that was dev-specific. If holdout agrees with dev, the dev number is trusted; if it does not, the changes since the last holdout run are suspect.

## Write phase: build the corpus

The write phase turns a question's history into a memsys memory. It is the expensive step (about $0.105 per question, $6.5 for dev, $55 for full; 98% of a whole-system run's cost) and it is not what this benchmark measures, so it runs once per writer version and the result is kept.

How it runs, unchanged from the current harness:

1. For each session, Pi gets the transcript in a fresh conversation, with memsys's full server instructions and tools, and is told the conversation has ended. It stores what it judges worth keeping with `remember`, `revise`, and `forget`.
2. The written log is exported, re-dated, and imported into the question's memory space.

Two decisions change from the current harness.

**Replay in the dataset's array order, not by date.** Checked against all 500 questions and the dataset's generator: sessions on the same day carry random times, so sorting by date flips the order of evidence in 38 temporal-reasoning questions and 1 knowledge-update question. The array order is the one the dataset means. Re-dating keeps each session's day from the dataset and assigns times within a day from the array index, so timestamps never go backwards and temporal questions still see the right days.

**Evidence in assistant turns counts.** An option to store only the user's turns was considered and rejected: the dataset's `has_answer` turns include assistant replies, and single-session-assistant questions depend on them.

A writer version is defined by everything that shapes what gets written: the write model, the server instructions, the descriptions of `remember`, `revise`, and `forget`, a harness version number, and the set. Any change to one of these is a new corpus. The harness version is bumped by hand when a change to the write harness alters what gets written (the prompt, the replay order, the redating); the commit and a hash of the harness files are recorded with the corpus for the reader, but a harness edit that does not touch writing keeps existing corpora valid. Changes to recall are not: the same corpus serves every recall experiment.

The write model and the recall model are independent parameters. The first corpora are written with the same model the baseline used; a second writer with a different model, or a different harness, is a separate corpus and a fair comparison target.

Known drift from real use: an assistant writes during the conversation, not after reading a finished transcript. This is the cheapest faithful way to build a corpus today and is documented as a limit, not solved here.

## Recall phase: the measurement

The recall phase gives an agent the question and only read access to the corpus, and records what it does.

- **Agent.** [Pi](https://pi.dev), on an [OpenCode Go](https://opencode.ai) subscription. Pi is the deliberate choice, more than any model: it is a minimal harness, so what it adds between the model and the tools is small and known, and it swaps models with one setting. The model is a parameter of every run, not part of the design. Today's default is `opencode-go/deepseek-v4.1-flash` (the 1017 snapshot) because it is the best balance of ability and price at the time of writing; that will change. Dev should be run with a second recall model before any holdout run, so that recall is not tuned to one model's habits.
- **Tools.** Exactly two: `list_tags` and `recall`, through the memsys MCP server with Pi's [`toolExposure`](https://pi.dev/docs/latest/mcp#control-tool-exposure): the server hidden, these two exposed directly. No write tools, and no change to memsys. Every Pi built-in tool is off (`--no-builtin-tools`), with no extensions beyond `builtin:mcp`, no context files, skills, or prompt templates, and the MCP resource tools excluded. An agent with `bash` or `read` could open the corpus files, the dataset, or the dev routes and answer from them, and the score would measure that escape, not recall. The harness checks every transcript after the run and fails the question if any other tool name appears. The baseline already runs this way: across its 18,741 tool calls, only memsys tools appear. The server instructions go into the system prompt in full, as the current harness already does.
- **Bounds.** At most 5 recall rounds per question; a sixth is refused, the question is marked as over budget, and what was found by then is still scored. The cap is a harness setting to revisit after the first runs. In the baseline, all evidence was first complete by round 1 in 31 questions, by round 2 in 9, 3 in 3, 4 in 4, 5 in 1, and 7 in 1, while 13 questions went past 5 rounds; the cap costs one question and stops the rest from reading the corpus out. How many fragments a call returns is not bounded by the harness: that is part of what is under test, and `read` charges for it.
- **Repeats.** Each question runs 3 times. The model is cheap (about $0.002 per question per run) and its variance is the main noise in this phase.
- **Output.** The transcript of every recall call: cue, context, what came back, in order.

Answering the question is kept as the last step of the transcript, graded as a secondary metric. The primary metrics come from the recall calls, not the answer.

## Ground truth: what counts as found

The dataset marks evidence at the session and turn level. memsys stores fragments, and one evidence turn can become zero, one, or several fragments. So the unit of scoring is the **evidence session**, and the labels are built once per corpus:

1. Every record in `memory.ndjson` carries the index of the session it was written from. For each evidence session, the candidates are the fragments written from it, usually 4 or 5.
2. A judge reads the candidates next to the session's `has_answer` turns and marks which fragments carry that content. The judge's scope is those few fragments, not the whole memory, which is what made the baseline's labels unreliable.
3. On dev, the labels are reviewed by hand and corrected. Corrected labels are committed with the manifest.

A question is **found** when every one of its required evidence sessions has at least one answer-bearing fragment among what recall returned, across all rounds. Required means: evidence sessions the dataset marks with answer turns (94 of the 500 questions' evidence sessions have none and cannot be labeled); for knowledge-update questions, only the last evidence session, which holds the current value, since the dataset's own grading rule asks for the updated answer and not for the one it replaced. Abstention questions require nothing: there is nothing to find, and they are scored on the answer alone.

If an evidence session produced no answer-bearing fragment at all, the writer missed it. Such questions are a **write miss**: reported separately and removed from the recall denominator, because no recall can find what was never written. The baseline suggests this is common for single-session-assistant questions.

## Scoring

Per question and run:

| Metric | What it is |
| --- | --- |
| found | Every evidence session has an answer-bearing fragment in the returned set |
| read | Total fragments returned across rounds, also as tokens. This is what the agent paid to read |
| rounds | Recall calls made; `over budget` when the cap was hit |
| noise | Returned fragments that are not answer-bearing, as a share of read |
| stale | For knowledge-update questions, returned fragments that hold a superseded value. Reported apart from noise |
| wasted rounds | Rounds that returned nothing, and rounds after the evidence was already complete |
| answer | LongMemEval correctness, secondary |

Aggregated per set and per type, with the three repeats shown as a range, not averaged away.

A **dump-everything baseline** is drawn once per corpus: the cost in fragments of reading the whole space, which is what enough rounds amount to. It is a reference line on reports, not a gate. The baseline's 37-round question is the case it exists to name.

How a change is judged, in order:

1. smoke: nothing is broken.
2. dev, paired against the last kept run: found does not drop; read or rounds visibly drop, or found rises. Both runs on the same corpus.
3. When several changes have been kept: a second recall model on dev, then holdout once.

There is no rule that every change must run every set. The small sets exist so that most changes never touch the big ones.

## Judge

Two judging jobs, both done with Jev (Workers AI), which the baseline checked against DeepSeek as a judge and found agreeing on 115 of 120 verdicts:

- **Evidence labels**, scoped to a session's candidates, as above.
- **Answer correctness**, with LongMemEval's own per-type rules ported from its `evaluate_qa.py`, already in `judge.ts` and `jev-judge.ts`.

Jev scores between 0.3 and 0.7 are flagged for a person to look at. The judge model is separate from the agent model and from the write model.

## What is under test

The thing being measured is whatever sits behind `recall` and `list_tags`, their parameters and how many fragments they hand back, plus the text that tells the agent how to use them. Anything that provides that interface can be plugged in and compared on the same corpus, including an engine that shares nothing with today's one.

Candidates queued today, all expected to change:

- BM25 fallback when the AND match is empty or thin
- Jev at `low` and `medium` as the narrowing step
- Anchor association: on, off, and its spread
- The wording of the `recall` description and the server instructions about when and how to recall
- The cue policy the agent is told to use, including the keyword-bag cue the baseline used. That cue is a candidate, not a given; the benchmark is what shows whether it works.

## Storage

The write phase is the expensive output and is kept forever. There will be several corpora: per writer version, and later per write model and per harness for side-by-side comparison. Dev-size corpora measured 4.1 MB of `memory.ndjson` and 12.5 MB of `sessions.jsonl` each; a full corpus is about 140 MB raw, 35 MB compressed.

Two places:

**The Git repo** keeps what a reader of a run needs to check it and what is small:

- `eval/longmemeval/corpora.json`, the manifest. One entry per corpus, named by set, write model, and a hash of the writer version (write model, server instructions hash, `remember`/`revise`/`forget` description hashes, harness version, set), with its cost, its commit, and its Hugging Face path.
- Human-corrected evidence labels per corpus.
- `memory.ndjson` for dev-size corpora, so that a recall run on dev needs no download.
- A slim question file per set: question, answer, evidence sessions and turns. Not the 277 MB dataset.

**A Hugging Face dataset repo** (`Hopsken/memsys-longmemeval-corpora`) keeps every corpus whole and immutable, one folder per key, with every artifact: `sessions.jsonl` (the write transcripts), `memory.ndjson`, `patch.ndjson`, the labels, and the instructions and tool descriptions that wrote it. A corpus is uploaded once and never changed; a changed writer is a new key. Hugging Face has no per-repo size limit, and the account quota (best-effort for public, 100 GB for private, per their storage-limits page as of this writing) is far above the tens of megabytes a corpus takes.

The recall phase reads `memory.ndjson`, the evidence labels, and the slim question file. It never needs the raw dataset.

Alternatives were considered and set aside: Git LFS in the main repo (quota and clone weight), a bucket on R2 (no browsing, no versioning for free), a separate Git repo (fine for small corpora, poor once there are many). Hugging Face gives browsing, versioning, and a dataset viewer at no cost, and is where this kind of artifact is expected to live.

## Costs

| Step                             | Cost per question | dev (60) | full (500) |
| -------------------------------- | ----------------- | -------- | ---------- |
| Write (once per corpus)          | $0.105            | $6.5     | $55        |
| Recall, 3 repeats                | $0.006            | $0.4     | $3         |
| Evidence labels, once per corpus | small (Jev)       |          |            |
| Answer judge                     | small (Jev)       |          |            |

Figures from baseline-1021 with `deepseek-flash`; OpenCode Go moves recall to a subscription.

## Limits

- Evidence labels are model-produced, reviewed by hand only on dev.
- The histories are small enough to fit a 1M context. The benchmark cannot show how recall behaves with 1,000 or 10,000 times the distractors; that needs other material.
- Evidence the assistant produced is often not written, so single-session-assistant questions mostly become write misses until the writer improves.
- A semantic gap (the cue and the memory share no word) is only reachable through more rounds and `list_tags`. The benchmark counts those rounds; it does not solve the gap.
- Writing happens after each conversation ends, not during it.
- baseline-1021 was written in date order and has 2 temporal questions with evidence in reversed order. It is kept as a reference and not used as a benchmark corpus.

## Alternatives considered

### Benchmark the whole system

That is what `eval/longmemeval/` does today and it stays. Its score moves with the writer, the agent, and the model, so it cannot tell a recall change from a lucky run. This RFC does not replace it; it isolates the part that can be measured cleanly.

### Score fragments instead of evidence sessions

The dataset has no fragment-level truth and one turn can become several fragments. Session-level "found" with a judge scoped to a handful of candidates is the smallest unit with a defensible label.

### One-shot recall

Rejected. memsys is used by an agent that can ask again, and a system tuned for one shot would be tuned for the wrong use. Allowing rounds and charging for them measures the real thing. The round cap keeps "ask until the corpus is empty" from counting as a win.

### A hard gate against the dump-everything line

Rejected. It would require every change to run the full curve. The line is a reference on reports; the gate is the paired dev comparison.

### Store corpora in the Git repo

Rejected for anything above dev size, see Storage.

## Open questions

- Which question types tell us nothing about recall and can be dropped from the sets.
- Whether 5 rounds is the right cap. Decide after the first dev runs.
- How to count a question whose evidence was found but whose answer is wrong: the baseline had 2 such questions and they are an agent problem, but a recall that returns the evidence buried in noise may be the real cause.
- Whether the three repeats should be reduced once the per-question variance is known.

## Decision

Build the benchmark as described. The harness changes, the dev corpus, its reviewed evidence labels, and the first kept recall run on dev land together with this RFC.
