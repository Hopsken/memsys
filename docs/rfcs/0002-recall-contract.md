# RFC 0002: Recall as a pipeline

- Status: Proposed
- Created: 2026-09-28
- Revised: 2026-09-29, 2026-10-23
- Discussion: pull request #51, pull request #62, [Amp thread](https://ampcode.com/threads/T-01a16769-1429-7192-876b-ddd66f368083)

## Summary

Recall is a flat list of stages. The agent sends a `cue` and an optional `context`; it gets back fragments and `truncated`. A host runs the stages and enforces a few rules. Which stages run, and how each one works, is not decided here: it changes with measurement on the recall benchmark (RFC 0003).

## Goal

Recall serves the goal in [VISION](../VISION.md). Each decision is judged by three costs:

- A **miss** costs a repeat: something memory held has to be said, found, or learned again. It costs the most.
- **Noise** costs tokens: the agent reads a fragment it did not need. It costs the least.
- A **misleading result** costs trust: the agent believes it saw everything relevant, or that a result was checked when it was not.

Memory holds two kinds of thing for the agent. **Known unknowns** it can name, and the cue reaches them. **Unknown unknowns** it would not think to ask for; recall reaches them by spreading from what the cue found to what sits near it, for example along shared anchors.

## Decisions

### 1. The agent sends only a cue and a context

`cue` is required: the words the agent has for what it needs. `context` is optional: what the agent is doing now. Any other field is a validation error.

**Why.** The agent knows what it looks for and what it does. It does not know how memory is laid out, how many fragments match, or how far spreading should reach. A parameter for any of those makes it guess from habits formed on other tools. So there is no `limit`: the agent copies a small page size from search APIs and cuts off the associations it did not know to ask for. There is no `associate`: switching spreading off asserts there are no unknown unknowns, which the agent cannot know. Reading everything under an anchor is enumeration, a listing tool's job, not a mode of recall.

### 2. Recall is a flat list of stages

A stage receives the candidates so far and the input. It returns refs, each with its `via` (why it is there), in its chosen order, and whether it made a cut that a more specific cue would recover. A stage may add fragments from the corpus, drop candidates, or reorder them. Matching, spreading, ranking, judging, and the final cut are all stages.

A built-in stage is always on and the tool description states what it does. A stage under trial is a plugin the owner can switch; it later becomes built in or is removed. A trial stage changes result quality, never the calling convention or what the description promises.

A capability that several stages need, such as relevance judgment, is a shared tool. It judges each candidate at most once per recall.

**Why.** A bound on matches is already a narrowing, and a filter can matter before spreading as much as after it, so generating and narrowing are not separate kinds of step. Named phases would only let one capability attach at two points; a shared tool does that without a second concept.

### 3. The host enforces three rules

1. **Text comes from the corpus.** The host resolves refs against the recall's snapshot and ignores unknown ones. No stage can invent or rewrite a fragment.
2. **`truncated` only goes up.** The host ORs the stages' cut reports.
3. **The result has a safety ceiling.** The host cuts the returned fragments to a fixed ceiling, sets `truncated`, and logs it. A correct pipeline never reaches it; it stops a broken stage from flooding the agent's context.

The host does not cap what flows between stages.

**Why.** No stage has to trust another. A stage sees only what reached it, so it has no grounds to clear `truncated`.

### 4. Each stage owns its bounds

A stage decides how much it adds, how much of its input it uses, and which cuts it reports. Only the output stage knows the result size.

**Why.** Only the stage knows what it cut and whether a better cue would bring it back. A stage whose cost grows with its input, such as one that calls a model, bounds that cost itself, for example by judging only the first candidates. If other stages knew the result size, their output would depend on the page.

### 5. A judging stage judges what it keeps, or the recall fails

A judging stage never passes on a candidate it did not judge. It may cut to its budget first and report the cut. If it cannot judge, it retries within a deadline, then fails the recall with one of two errors:

- **Transient** (timeout, gateway error, unanswered candidate): try again shortly.
- **Persistent** (no balance, model gone): the owner must act; retrying will not help.

**Why.** An unfiltered list with a warning reads as a checked list, which is the trust cost. Agents act on errors. Two classes keep an agent from retrying into an empty balance. Stopping once a page is full would make the judgment depend on the result size.

### 6. `truncated` reports cuts a better cue can recover

`truncated: true` means some relevant memories were left out and a more specific cue would reach them. The remedy is a more specific cue, or recalling an anchor from `via`. A cut to spreading is not reported: no cue change brings those fragments back through spreading, and hub anchors would keep the flag set. Those fragments stay reachable by a direct cue or by their anchor.

**Why a boolean.** A count before judging counts fragments the judge rejected; a count after judging means different things on different instances. Both invite paging. Recall has no cursor, so the name is not `hasMore`.

## Public contract

- MCP `recall` and `POST /api/recall` take `{ cue, context? }` and return `{ fragments, truncated, warnings? }`. Stages receive `{ cue, context }`.
- The `cue` description gives its forms (a few distinctive words, a phrase, #anchors), how the built-in stages match it, and what to change when results are too few or too many.
- The `context` description asks for it whenever the agent has a task.
- A failed judging stage returns an error that says whether to retry.
- The web recall preview shows exactly what the agent gets.

## Consequences

- Where a judging stage calls a model, every recall bills it, and an outage longer than the retries fails recall.
- A recall's corpus snapshot lives as long as its slowest stage, so a fragment changed meanwhile can come back in its earlier form.

## Migration

No transition period. `limit` and `associate` are removed; `truncated` replaces `hasMore`; a stage hook replaces `afterRecall`; matching and spreading move from core into built-in stages; the web preview drops "Show more"; Architecture.md is rewritten to match.

## Not in this RFC

Which stages run and their values; judging seeds before spreading; when a judging stage becomes built in; `cue` as a list; generating from `context`, time, or meaning; enumeration (the planned memfs plugin); consolidation and decay.

## Open questions

- The value of the result ceiling. One fragment can run to a few hundred words.
- How `via` names reasons other than anchors.
- How often a judging model leaves candidates unanswered.

## Testing

- Host: no text outside the corpus; `truncated` never clears; the result ceiling cuts and sets `truncated`.
- Input: fields other than `cue` and `context` are rejected.
- Judging: every kept candidate is judged at any result size; a budget cut sets `truncated`; transient failures retry, then fail with the transient message; persistent failures fail at once.
- The recall benchmark on the dev set, against the last run.
