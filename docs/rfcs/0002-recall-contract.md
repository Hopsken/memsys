# RFC 0002: Recall as a pipeline

- Status: Proposed
- Created: 2026-09-28
- Revised: 2026-09-29, 2026-10-23
- Discussion: pull request #51, pull request #62, [Amp thread](https://ampcode.com/threads/T-01a16769-1429-7192-876b-ddd66f368083)

## Summary

Recall is the read side of memsys. This RFC defines two things:

- **The contract.** What the agent sends, what it gets back, and what each signal in the result tells it to do next.
- **The shape behind the contract.** Recall is one flat list of stages. A host runs the list and enforces a few rules that every stage obeys.

In short:

- The agent sends a `cue` and, when it has a task, a `context`. Nothing else.
- Each stage may add, drop, or reorder candidates. Matching, spreading, ranking, judging, and the final cut are all stages.
- Each stage owns its bounds. A stage that leaves out something a more specific cue would reach sets `truncated`.
- The host takes all text from the corpus, keeps `truncated` from ever going back to false, and caps the result.
- A judging stage never passes on a candidate it did not judge. If it cannot judge, the recall fails with an error that says whether to retry.

This RFC does not decide which stages run, in what order, or how each one matches, bounds, ranks, or judges. Those change with measurement on the recall benchmark (RFC 0003) and need no revision here.

## Goal

Recall serves the goal in [VISION](../VISION.md). VISION decides what memory holds; this RFC does not.

Every decision below is judged by three costs:

- A **miss** costs a repeat. Something memory already held has to be said, found, or learned again. This is the cost memsys exists to remove.
- **Noise** costs tokens. The agent reads a fragment it did not need. A capable agent skips it.
- A **misleading result** costs trust. The agent believes it saw everything relevant, or believes a result was checked when it was not, and acts on that belief.

A miss costs the most and noise the least. Whether a step uses a model is not a criterion. A model is a means, judged by the same three costs.

## Terms

- **Candidate**: a fragment that a stage has put in the list, with its reason.
- **Stage**: one step of recall. It receives candidates and returns candidates.
- **Host**: the code that runs the stages and enforces the rules in [The host](#the-host).
- **Cut**: a stage leaves out candidates it could have kept.
- **Judging stage**: a stage that drops candidates by a relevance judgment, for example a model's.
- **`via`**: the reason a candidate is in the list. A direct match has none. An association lists the anchors that brought it.

## Design

### What recall has to reach

Memory holds two kinds of thing for the agent:

- **Known unknowns.** The agent knows it needs them and can name them: "what did we decide about D1 regions?" The `cue` reaches these through the words they share.
- **Unknown unknowns.** They bear on the task, but the agent would not think to ask: a lesson from a similar mistake, a constraint set months ago. Recall reaches these by spreading from what the cue found to what sits near it, for example along shared anchors. Time, meaning, and the `context` are other neighbourhoods to spread along.

Recall has to serve both. The agent can only describe the first kind.

### The pipeline

Recall is a flat list of stages that run in order. For example:

```
cue, context ──► match ──► spread ──► rank ──► judge ──► output ──► fragments, truncated
```

The names and the order are an example, not a decision.

A stage receives the candidates so far and the recall input. It returns:

- the candidates it passes on, each as a ref with its `via`, in its chosen order;
- whether it cut anything that a more specific cue would reach.

A stage may add fragments from the corpus, drop candidates, or reorder them. It decides how much of its input it uses. For example, a judging stage may send only the first candidates to its model, drop the rest, and report the cut.

Nothing separates generating from narrowing. A bound on what a stage adds is already a narrowing. A filter can run wherever weak candidates would otherwise do harm, not only at the end.

### Built in and under trial

- A **built-in** stage is always on. It does not show in settings. The tool description states what it does.
- A **stage under trial** is a plugin that the owner can switch on and configure. When the evidence is in, it becomes built in or is removed.

The plugin system exists to run trials. It does not promise that every part of recall can be swapped.

### The host

The host runs the list and enforces three rules, so no stage has to trust another:

1. **Text comes from the corpus.** A stage returns refs. The host takes each fragment's text from the recall's snapshot of the corpus and ignores unknown refs. No stage can invent or rewrite a fragment.
2. **`truncated` only goes from false to true.** The host ORs the cut reports of all stages.
3. **The result has a safety ceiling.** The host cuts the returned fragments to a fixed ceiling, sets `truncated`, and logs the cut. A correct pipeline never reaches the ceiling. It exists so that a broken or misconfigured stage cannot flood the agent's context.

The host does not cap what flows between stages.

### Shared tools

A capability that several stages need is a tool, not a stage. Relevance judgment is the first: given the cue, the context, and some candidates, judge each one. The tool owns batching, retries, error classes, and a per-recall cache. A candidate is judged at most once per recall, whichever stage asks.

### The result

The agent gets an ordered list of fragments, each with its `via`, and `truncated`.

- **`truncated: true`** means some relevant memories were left out, and a more specific cue would reach them. The remedy is to use a more specific cue, or to recall an anchor from `via`.
- **An error** means a judging stage could not finish. Its text says either "try again shortly" or "the memory's owner must act; retrying will not help".

## Decisions

### 1. The agent sends a cue and a context

`cue` is required: the words the agent has for what it needs. `context` is optional: what the agent is doing right now. The tool asks for it whenever the agent has a task.

**Why.** A parameter should stand for something the caller knows. The agent knows what it is looking for and what it is doing. It does not know how memory is laid out, how many fragments match, or how far spreading should reach. A parameter for any of those makes it guess, and it guesses from habits it formed on other tools.

`context` tells judging stages what "relevant" means for this call. A stage may also generate candidates from it.

### 2. The agent cannot switch spreading off

There is no `associate` parameter.

**Why.** Spreading exists for unknown unknowns. An agent that switches it off asserts that it has none, and it is poorly placed to judge that. Whether spreading runs, how far, and how much it keeps belong to the pipeline.

Reading every fragment under an anchor, such as `#must-read`, is enumeration, not recall. It wants every item, in order, with nothing added and nothing judged. A listing tool does that (the planned memfs plugin), not a switch on recall.

### 3. The system sizes the result

There is no `limit` parameter. Stages do not receive one either.

**Why.** The agent does not know how much it does not know, so it cannot choose a size. It copies a habit from search APIs, and the habit is small: 5 or 10. A small size cuts off exactly the associations the agent did not know to ask for. The pipeline knows how wide the spread was and how much judging kept, so it is better placed to choose.

### 4. Recall is a flat list of stages

Every part of recall that finds, ranks, filters, or cuts is a stage in one ordered list.

**Why a pipeline.** Generating and narrowing are not different kinds of thing: a bound on matches is a narrowing. A filter can matter before spreading as much as after it. A fixed split, with generation in core and filters only at the end, puts every new way of finding memories in core and keeps filters away from where they help most.

**Why flat.** Named phases (generate, spread, finish) mainly let one capability attach at two points. A shared tool does that without phases: each stage that needs the capability calls it. A flat list is one rule to learn, and its order is the order the code runs.

### 5. Each stage owns its bounds

A stage decides how much it adds, how much of its input it uses, and which of its cuts set `truncated`. The host caps only the result.

**Why.** Only the stage knows what it cut and whether a different cue would bring it back. A bound from outside cannot tell a cut of strong matches from a cut of weak ones. A stage whose cost grows with its input, such as one that calls a model, bounds that cost itself and reports the cut.

### 6. Only the output stage knows the result size

The output stage is the only stage that reads how many fragments a recall returns. Every other stage behaves the same at any size.

**Why.** The size can then change without touching any other stage, and no stage's judgment depends on the page.

### 7. A judging stage judges what it keeps, or the recall fails

A judging stage never passes on a candidate as judged when it was not. It may cut to its own budget before it judges, and reports that cut. Every candidate it keeps, it judges.

If it cannot judge, it retries within a deadline. If it still cannot, the recall fails with one of two errors:

- **Transient** (a timeout, a gateway error, an unanswered candidate): try again shortly.
- **Persistent** (no balance, a model that no longer exists): the memory's owner must act; retrying will not help.

The cause goes to the log.

**Why an error, not a warning.** Agents act on errors. A warning inside a successful result is easy to skip, so an unfiltered list with a warning reads as a checked list. That is the trust cost. With retries in front of it, the error is rare. Two classes keep the agent from retrying into an empty balance.

**Why not stop once the page is full.** The judgment would then depend on the result size (against decision 6). A later stage that reorders or drops could also need a candidate that was never judged.

### 8. `truncated` reports cuts a better cue can recover, and only goes up

The result carries `truncated: true` when some stage cut candidates that a more specific cue would reach. Each stage decides what it reports. The host ORs the reports.

A cut to spreading is not reported. It is forgetting: no cue change brings those fragments back through spreading, and counting them would make every hub anchor set the flag. Those fragments stay reachable by a cue that matches them directly, or by recalling the anchor.

**Why only up.** A stage sees only what reached it. It cannot know whether an earlier stage dropped something relevant, so it has no grounds to clear the flag. The host enforces this, so no stage has to get it right.

**Why a boolean, not a count.** A count has to count something. Candidates before judging tells the agent that many fragments exist that it "cannot see", when judging rejected them. Survivors after judging changes meaning with each instance's stages, so the same agent code reads it differently on different memories. And a number invites paging toward it.

**Why not `hasMore`.** `hasMore` is paging vocabulary and promises a cursor. Recall has no cursor. The remedy is "ask differently", not "call again".

### 9. Unknown input fields are errors

The input schema is strict. A caller that sends a field other than `cue` or `context` gets a validation error.

**Why.** Silently ignored fields keep wrong mental models alive in agents' notes about the tool. The few connected clients belong to the owner, who can reconnect them.

## Public contract

- MCP `recall` and `POST /api/recall` take `{ cue, context? }`.
- The `cue` description gives the forms a cue takes (free text, a few distinctive words, a phrase, #anchors), how the built-in stages match it, and what to change when the results are too few or too many.
- The `context` description: what you are doing right now, the task or the problem. Send it whenever you have one. It decides which memories are worth returning.
- `RecallResult` is `{ fragments, truncated, warnings? }`. `warnings` explains an adjusted request.
- `RecallInput`, which stages receive, is `{ cue, context }`.
- A stage receives the candidates and the input. It returns refs with their `via`, and whether it made a cut that a more specific cue would recover.
- A failed judging stage returns an error whose text says whether to retry.
- The web recall preview shows exactly what the agent gets.

The tool description states what the built-in stages do, including how they match the cue. A stage under trial changes result quality only. It never changes the calling convention or anything the description promises.

## Consequences

- Where a judging stage calls a model, every recall bills that model, and an outage that outlasts the retries fails recall until it ends. If a judging stage becomes built in, this holds for every instance.
- A recall's snapshot of the corpus lives as long as its slowest stage. A fragment revised or forgotten in that time can come back in its earlier form.
- Core holds the host, the recall contract, and the durable layer. How recall finds memories lives in built-in stages.

## Migration

The code today does not match this RFC. The implementation changes these things, with no transition period:

- `limit` and `associate` leave MCP, REST, and `RecallInput`.
- `truncated` replaces `hasMore`.
- The stage hook replaces `afterRecall`. Matching and spreading move from core into built-in stages.
- The web preview drops "Show more".
- Architecture.md is rewritten. Its "recall has two stages" and "plugins attach only at the terminal" described the old code, not a rule.

## Alternatives considered

### Generation in core, filters only at the end

Every change to matching or spreading becomes a core change, and no filter can act before weak matches seed spreading.

### The host bounds what flows between stages

A bound is a narrowing, and only the stage that cuts knows whether a cue change recovers the cut. The host caps only the result.

### Named phases

A shared tool gives their one benefit, a capability at two points, without a second concept. See decision 4.

### Stages may clear `truncated`

A stage cannot see earlier cuts, so it has no grounds to clear the flag.

### Return an empty result when no stage generates

An empty result reads as "nothing relevant", which misleads. The built-in generating stages are always on, so this does not happen in a deployment.

### `limit` as a pure output cap

Decision 6 makes it harmless to the pipeline. It stays harmful to the agent, who sets it from habit and cuts off spreading.

### A count instead of a boolean

See decision 8.

### Fail open with a warning

See decision 7.

### A judging stage stops once a page is full, or passes its unjudged tail through

Unjudged candidates would reach the agent as judged, and the judgment would depend on the result size. See decisions 6 and 7.

### Fail when a stage finds too much

This throws away valid candidates. A cut with `truncated` gives the same advice.

### Count spreading cuts toward `truncated`

Hub anchors would keep the flag set, and no cue change recovers those fragments through spreading.

### A recall mode for exhaustive reads

Enumeration is a different operation: paged, in order, with no spreading and no judging. It is the planned memfs plugin's job.

## Background

The shape is old. It matches well-studied parts of human memory, which gives some assurance that the parts fit together:

- **Cue matching** follows the encoding specificity principle (Tulving and Thomson, 1973): retrieval succeeds to the extent the cue overlaps what was encoded. This is also why the write path matters as much as the read path.
- **Spreading** is spreading activation (Collins and Loftus, 1975; Anderson's ACT-R): activation flows from cued items to their neighbours.
- **Bounds per anchor and ranking by anchor rarity** follow the fan effect (Anderson, 1974) and the cue-overload principle (Watkins and Watkins, 1975): a cue shared by many items is a weak cue for each. `#work` is an overloaded cue.
- **`context`** is context-dependent retrieval (Godden and Baddeley, 1975; Howard and Kahana's temporal context model, 2002).
- **Spreading for unknown unknowns** is reminding (Schank, _Dynamic Memory_, 1982) and involuntary memory (Berntsen, 2009): the situation, not a search, brings the relevant episode back, and distinctive cues do it best.
- **Finding, then judging** is the generate-recognize account of recall (Bahrick, 1970; Anderson and Bower, 1972), with judging as the monitoring stage of Koriat and Goldsmith (1996), where a confidence criterion trades quantity for accuracy. The same work records the risk: a recognition stage can reject items that would have been recalled correctly. A judging stage's default is therefore judged by what it misses.

What memsys does not do on its own, such as forgetting, consolidation, and reweighting by use, is the slow system of complementary learning systems theory (McClelland, McNaughton, and O'Reilly, 1995). Those belong to plugins that propose changes through the core write tools. The core stores text verbatim.

## Not in this RFC

- **Which stages run, and their rules and values.** Measured on the recall benchmark.
- **Judging seeds before spreading.** A spreading stage that uses the judgment tool to pick its seeds. It is part of how spreading works, so it does not follow the switch of any judging stage under trial.
- **When a judging stage becomes built in, and how strict it is.** Decided by its miss rate on the benchmark.
- **`cue` as a list.** One call with several handles ("vite 403", "allowedHosts", "#vite") would save round trips and repeated judging. It is additive.
- **Generating from `context`, time, or meaning.** Further stages that add candidates.
- **Enumeration.** The planned memfs plugin.
- **Consolidation and decay.** Plugins that propose writes through the core tools.

## Open questions

- **The value of the result ceiling.** It should sit only a little above what a recall is meant to return, because one fragment can run to a few hundred words.
- **How `via` names reasons other than anchors**, once a stage adds candidates by time, meaning, or `context`.
- **How often a judging model leaves candidates unanswered.** Failing on an unanswered candidate is only practical if it is rare.

## Testing

- Host: a stage cannot add text that is not in the corpus; once `truncated` is set, no later stage clears it; the result ceiling cuts and sets `truncated`.
- Input: a field other than `cue` or `context` is rejected; `context` is optional.
- Judging: every kept candidate is judged at any result size; a cut to the stage's budget sets `truncated`; a transient failure is retried, then fails with the transient message; a persistent failure fails at once with the persistent message.
- The recall benchmark (RFC 0003) on the dev set, against the last run.
