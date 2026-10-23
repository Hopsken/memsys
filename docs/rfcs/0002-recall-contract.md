# RFC 0002: Recall as a pipeline: inputs, stages, and `truncated`

- Status: Proposed
- Created: 2026-09-28
- Revised: 2026-09-29, 2026-10-23
- Discussion: pull request #51, [Amp thread](https://ampcode.com/threads/T-01a16769-1429-7192-876b-ddd66f368083)
- Implementation: pull request #50 implemented an earlier draft and was closed. A new pull request follows this revision.

## Summary

Recall is the read side of memsys. This RFC fixes its contract: what the agent sends, what it gets back, and what each signal in the result tells it to do next. It also fixes the shape behind the contract: recall is one flat pipeline of stages, and the host that runs it enforces a few rules every stage obeys.

- Recall takes a `cue` and, whenever the agent has one, a `context`. The `associate` and `limit` parameters go away.
- Recall is a flat list of stages. Each stage may add, drop, or reorder candidates. Matching the cue, spreading along anchors, ranking, filtering, and cutting to the output are all stages, and a filter can sit anywhere in the list.
- Each stage owns its bounds. What flows between stages is not limited; a stage that takes only part of its input says so with `truncated`. The host keeps one absolute safety ceiling, on the result.
- A stage that judges relevance never passes an unjudged candidate on as judged. If it cannot judge, it retries, then fails the recall with an error that says whether to retry.
- The result carries `truncated`, replacing `hasMore`. Any stage may set it; no stage can clear it.

Which stages run, in what order, and how each one matches, bounds, ranks, and judges are not decided here. They change with measurement on the recall benchmark (RFC 0003) and need no revision of this RFC.

## Goal

Recall serves the goal set in [VISION](../VISION.md); what memory holds is decided there, not here. Every decision below is judged against that goal through three costs:

- A **miss** costs a repeat: something memory already held has to be said, found, or learned again. This is the cost the product exists to remove.
- **Noise** costs tokens. The agent reads a fragment it did not need. A capable agent skips it and moves on.
- A **misleading result** costs trust. The agent believes it saw everything relevant, or believes a result was checked when it was not, and acts on that belief.

Misses are the most expensive and noise the cheapest. Whether a step uses a model is not a criterion. It is a means, judged like any other by these costs.

## Motivation

Before this RFC, recall took `cue`, `context`, `associate`, and `limit`, and returned `fragments` and `hasMore`. Core generated the candidates; plugins could only reorder or drop them at the end.

- **The tool description was wrong.** It said `hasMore` meant "more fragments matched", but associations counted too. Two matches carrying a hub anchor such as `#work` kept `hasMore` true at any `limit` and with any cue, so neither remedy it suggested worked.
- **Jev turned `hasMore` into a false "you saw everything".** Jev judged at most 40 candidates and dropped the rest. With `matches` on (the default), at most 40 survived, so at `limit` 40 `hasMore` was always false, even with hundreds of matches.
- **Jev failed open.** A timeout, error, or malformed response returned the candidates unfiltered, and the agent read them as filtered. That is the trust cost: a misleading answer costs more than an error.
- **One Jev request could overflow its context.** Forty fragments at the 1000-character cap, in CJK text, can exceed Jev's 32k-token window, which then failed open silently.
- **`limit` leaked into generation.** Only the top `limit` matches seeded associations, so how far recall spread depended on the page size.
- **`limit` invited search-engine habits.** Agents set `limit` from habit, 5 or 10, the way they page a search API. The agent does not know how many memories bear on its task, and a small `limit` cut off exactly the associations it did not know to ask for.
- **`associate` asked the agent a question it cannot answer.** Turning association off is a claim that the agent already knows everything it needs. No known caller ever sent it.
- **Generation was fixed in core.** Trying another way to match the cue meant changing core and threading a switch through the request path. A filter could only run after association, so weak matches seeded associations before anything judged them.

## The model

Two kinds of thing are in memory for the agent:

- **Known unknowns.** Things the agent knows it needs and can name: "what did we decide about D1 regions?" The `cue` reaches these through the words they share.
- **Unknown unknowns.** Things that bear on the task but the agent would not think to ask for: a lesson from a similar mistake, a constraint set months ago. Association reaches them today: from what the cue found, recall spreads along shared anchors to what sits nearby, the way a thought brings its neighbours with it. Spreading along other neighbourhoods, such as time, meaning, or the `context`, is the same idea.

Recall is a flat list of stages run in order. The stages below are an example, close to what runs today:

```
cue, context ──► match ──► spread ──► idf ──► jev ──► output ──► fragments, truncated
                 ╰────────────── stages, in list order ─────────╯
```

### Stages

A stage receives the current candidates and the recall input, and returns new candidates and whether it cut anything a more specific cue would reach. It may add fragments from the corpus, drop candidates, or reorder them. Each candidate carries `via`, the reason it is there: a direct match has none; an association lists the anchors that brought it.

Nothing separates generating from narrowing. Bounding what a step adds is already narrowing, and a filter is useful wherever weak candidates would otherwise go on to do harm, not only at the end. With no stage that adds candidates, recall returns nothing; the built-in generating stages are always on, so that does not happen in a deployment.

### Built in and under trial

A stage that has proven itself is built in: always on, not shown in settings, and described in the tool description as part of what recall does. A stage under trial is a plugin the owner can switch and configure. It becomes built in or is removed once the evidence is in. The plugin system exists to run those trials; it is not a promise that every part of recall can be swapped.

### The host

The host runs the list and enforces three rules, so no stage has to trust another:

1. **Text comes from the corpus.** A stage returns refs and reasons. The host takes the text from the recall's corpus snapshot, so no stage can invent or rewrite a fragment.
2. **`truncated` only goes up.** Each stage reports whether it cut something. The host ORs the reports. A later stage cannot see what an earlier one cut, so it cannot know whether to clear the flag, and it cannot.
3. **An absolute safety ceiling on the result.** The host cuts the fragments returned to the agent to a fixed ceiling, sets `truncated`, and logs the cut. The ceiling is not policy, and a correct pipeline never reaches it; it keeps a misconfigured or broken stage from filling the agent's context.

The host does not limit what flows between stages. Which candidates a stage uses is the stage's choice: a judging stage may take only the first few of its input to the model, drop the rest, and report the cut through `truncated`.

### Shared tools

A capability several stages need is a tool, not a stage. The first is Jev's relevance judgment: given the cue, the context, and some candidates, judge each. Batching, retries, error classes, and a per-recall cache live in the tool, once, so a candidate is judged at most once per recall whichever stage asks. The `jev` stage uses it today; a later spread stage may use it to pick its seeds.

## Decisions

### 1. Recall takes what the agent knows: a cue and a context

`cue` is required: the words the agent has for what it needs. `context` is optional, but the tool asks for it whenever the agent has a task: what it is doing right now.

**Why.** A parameter should stand for something the caller knows and cares about. The agent knows what it is looking for and what it is doing. It does not know how memory is laid out, how many fragments match, or how far association should reach. A parameter for any of those asks it to guess, and in practice it guesses from habits formed on other tools.

`context` tells judging stages what "relevant" means for this call. No stage generates from it today; one may later.

### 2. Association is not the agent's to switch; `associate` is removed

**Why.** Association exists for unknown unknowns. An agent that turns it off asserts it has none, which is a judgment it is poorly placed to make. Whether spreading runs, how far, and how much of what it finds is kept belong to the pipeline. The web client never sent `associate`, and no agent was observed to.

The one case that looked like a reason to turn it off, reading every fragment under an anchor such as `#must-read`, is enumeration, not recall: it wants every item, in order, with nothing added and nothing judged. That belongs to a listing tool (the planned memfs plugin), not to a switch on recall.

### 3. The system sizes the result; `limit` is removed

**Why.** The agent does not know how much it does not know, so it cannot choose a size. In practice it copies a habit, and the habit is small. A small `limit` shuts the association channel. The system knows how wide the spread was and how much judging kept, so it is better placed to size the result.

`RecallInput`, which stages receive, drops `limit` too.

### 4. Recall is a flat list of stages

Every part of recall that finds, ranks, filters, or cuts is a stage in one ordered list. A stage may add, drop, or reorder. The host enforces the rules in [The host](#the-host).

**Why a pipeline.** Generation and narrowing are not different kinds of thing. A bound on matches is a narrowing, and a filter can matter before association as much as after it. A fixed split, core generating and plugins narrowing at the end, placed every new idea about finding memories in core, and kept filters away from the point where they help most.

**Why flat, not named phases.** Named phases (generate, spread, finish) would mainly let one capability attach at two points. A shared tool does that without phases: each stage that needs the capability calls it. A flat list is one rule to learn, and its order is the order the code runs.

### 5. Each stage owns its bounds

A stage decides how much it adds, how much of its input it uses, and whether a cut it makes sets `truncated`. Nothing between stages is capped by the host.

**Why.** Only the stage knows what it cut and whether a different cue would bring it back. A bound imposed from outside cannot tell a cut of strong matches from a cut of weak ones. A stage whose cost grows with its input, such as one that calls a model, bounds that cost itself, where it can also report the cut. The one host ceiling, on the result, exists only so a mistake cannot flood the agent's context.

### 6. No stage depends on the output size

The output stage is the only stage that reads how many fragments a recall returns. Every other stage behaves the same whatever that number is, so it can change without touching them.

### 7. A judging stage judges what it keeps, or fails, and a failure says what to do

A stage that filters by judgment never passes a candidate on as judged when it was not. It may cut to its own budget before judging, and sets `truncated` when that cut drops candidates a more specific cue would reach. What it keeps, it judges. If it cannot, it retries within a deadline. If it still cannot, the recall fails with an error the agent can act on:

- A **transient** failure (a timeout, a gateway error, an unanswered candidate) says to try again shortly.
- A **persistent** failure (no balance, a model that is gone) says the memory's owner must act and that retrying will not help.

The cause goes to the log.

**Why an error rather than a warning.** Agents reliably act on errors; a warning inside a successful result is easy to skip. A result plus a warning reads as a result: the agent is likely to take the unfiltered list as checked, which is the trust cost. With retry in front of it, the error should be rare. Two error classes keep an agent from retrying into an empty balance.

**Why not stop early once the page is full.** The result would depend on the output size (against decision 6), and a stage after it that reorders or drops could then need what was never judged.

### 8. `truncated` replaces `hasMore`, and only goes up

The result carries `truncated: true` when some stage cut candidates that a more specific cue would reach. Each stage decides what it reports; the host ORs the reports, so once set the flag stays set.

The tool describes it as: some relevant memories were left out; use a more specific cue, or recall an anchor from `via`.

A cut is reported only if a cue change can recover it. A cut to associations is forgetting: no cue change brings those fragments back through association, and counting them would make every hub anchor set the flag. They stay reachable by a cue that matches them directly, or by recalling the anchor.

**Why only up.** A stage sees only what reached it. It cannot know whether an earlier stage dropped something relevant, so it has no grounds to clear the flag. Enforcing that in the host keeps every stage from having to get it right.

**Why a boolean and not a count.** A count has to count something: matches before judging, or survivors after. The first tells an agent, on an instance with Jev on, that 134 fragments exist that it "cannot see", when they are the ones judged irrelevant. The second changes meaning with the instance's stages, so the same agent code reads it differently on different memories. And a number invites paging toward it.

**Why rename.** `hasMore` is the vocabulary of paged APIs and promises a cursor. Recall has none, and the remedy is not "call again" but "ask differently".

### 9. No transition

The input schema is strict. A caller that sends `associate` or `limit` gets a validation error. Clients reconnect and re-read the tool schema.

**Why.** Ignoring the fields for a release would keep the old mental model alive in agents' descriptions of the tool, and the few connected clients are the owner's to reconnect.

## Public contract

- MCP `recall` and `POST /api/recall` take `{ cue, context? }`. Sending `associate` or `limit` is a validation error.
- `cue` is described as: free text, a few distinctive words, a phrase, or #anchors, followed by how the built-in stages match it and what to change when results are too few or too many.
- `context` is described as: what you are doing right now, the task or the problem. Send it whenever you have one; it decides which memories are worth returning. It does not take part in matching.
- `RecallResult` is `{ fragments, truncated, warnings? }`. `warnings` stays for adjusted requests; nothing sets it today.
- `RecallInput`, which stages receive, is `{ cue, context }`.
- A stage hook replaces `afterRecall`. It receives the candidates and the input, and returns refs with their `via`, and whether it cut anything a more specific cue would reach. The host resolves refs against the corpus, ignores unknown ones, and ORs the cut reports into `truncated`.
- A failed judging stage returns an error whose text says whether to retry.
- The web recall preview drops "Show more" and shows exactly what the agent gets.

The tool description states what the built-in stages do, including the matching rule. A stage the owner can switch changes result quality, never the calling convention or anything the description promises.

## Consequences

- Where a judging stage runs, an outage of its model that outlasts the retries fails recall until it passes, and every recall bills the model. Jev is planned to become built in, so this will hold for every instance.
- A recall's snapshot of the corpus lives as long as its Jev requests, so a fragment revised or forgotten meanwhile may come back in its earlier form.
- Architecture.md is rewritten with the implementation. "Recall has two stages" and "plugins attach only at the terminal" described the code, not a rule. Core keeps the host, the recall contract, and the durable layer; how recall finds memories moves to built-in stages.

## Alternatives considered

### Core generates; plugins narrow at the end

The earlier draft of this RFC. Every change to matching or spreading becomes a core change, and a filter cannot act before weak matches seed associations.

### Bound generation in the host, before narrowing

Also the earlier draft. A bound is a narrowing, and only the stage that cuts knows whether a cue change would recover the cut. The host keeps only a safety ceiling on the result.

### Named phases

Covered under decision 4. A shared tool gives the one benefit, a capability at two points, without a second concept.

### Stages may clear `truncated`

A stage cannot see earlier cuts, so it has no grounds to clear the flag.

### Return empty when no stage generates

An empty result reads as "nothing relevant", which misleads. The built-in generating stages are always on, so the case does not arise in a deployment.

### Keep `limit` as a pure output cap

Decision 6 makes `limit` harmless to the pipeline. It stays harmful to the agent, who sets it from habit and shuts the association channel.

### A count instead of a boolean

Covered under decision 8.

### Fail open with a warning

Covered under decision 7.

### Stop Jev once a page is full

Saves Jev calls at the cost of decisions 6 and 7.

### Pass Jev's unjudged tail through

Unchecked candidates would reach the agent as checked.

### Fail when a stage finds too much

This discards valid candidates; a cut with `truncated` gives the same advice.

### Count spread cuts toward `truncated`

Hub anchors would keep the flag set, and no cue change recovers those associations.

### A list-by-tag tool for exhaustive reads

Enumeration is a different operation: paged, in order, with no spread and no judging. It is the planned memfs plugin's job, not a mode of recall.

### Ignore removed fields for a release

Covered under decision 9.

## Background

The shape is old. Recall as designed here corresponds to well-studied parts of human memory, which is some assurance that the parts fit together:

- **Cue matching** follows the encoding specificity principle (Tulving and Thomson, 1973): retrieval succeeds to the extent the cue overlaps what was encoded. This is also why the write path matters as much as the read path.
- **Spread along anchors** is spreading activation (Collins and Loftus, 1975; Anderson's ACT-R): activation flows from cued items to their neighbours.
- **Per-key ceilings and `idf`** follow the fan effect (Anderson, 1974) and the cue-overload principle (Watkins and Watkins, 1975): a cue shared by many items is a weak cue for each. `#work` is an overloaded cue.
- **`context`** is context-dependent retrieval (Godden and Baddeley, 1975; Howard and Kahana's temporal context model, 2002).
- **Association for unknown unknowns** is reminding (Schank, _Dynamic Memory_, 1982) and involuntary memory (Berntsen, 2009): the situation, not a search, brings the relevant episode back, and distinctive cues do it best.
- **Finding then judging** is the generate-recognize account of recall (Bahrick, 1970; Anderson and Bower, 1972), with judging as the monitoring stage of Koriat and Goldsmith (1996), where a confidence criterion trades quantity for accuracy. The same literature records the risk: a recognition stage can reject items that would have been recalled correctly, which is why a filter's default should be judged by what it misses.

What memsys does not do on its own, forgetting, consolidation, reweighting by use, is the slow system of complementary learning systems theory (McClelland, McNaughton, and O'Reilly, 1995). Those belong to plugins that propose changes through the core write tools; the core stores verbatim.

## Not in this RFC

- **Judging seeds before spread.** A spread stage that uses the judgment tool to pick its seeds, so weak matches never seed associations. It will not follow the `jev` stage's switch: it is part of how spread works. Measured separately.
- **When Jev becomes built in, and its strictness.** Decided by its miss rate on the benchmark.
- **`cue` as a list.** One call carrying several handles ("vite 403", "allowedHosts", "#vite") would save round trips and duplicate judging. It is additive.
- **Generating from `context`.** A stage that finds candidates from what the agent is doing, not only from the cue words.
- **Spread along time or meaning.** Further stages that add candidates.
- **Enumeration.** Reading every fragment under an anchor is the planned memfs plugin's job.
- **Consolidation and decay.** Plugin-layer work that proposes writes through the core tools.

## Open questions

- **The value of the result ceiling.** It should sit only a little above what a recall is meant to return, since fragments run to a few hundred words.
- **How `via` names reasons other than anchors**, once a stage adds candidates by time, meaning, or `context`.
- **How often a judging model omits answers.** Failing on an omission is only practical if omissions are rare.

## Testing

- Host: a stage cannot add text not in the corpus; `truncated` once set stays set; the result ceiling cuts and sets `truncated`; a stage that uses only part of its input sets `truncated` and later stages cannot clear it.
- Input: `associate` and `limit` are rejected; `context` is optional.
- Judging: every kept candidate is judged whatever the output size; a transient failure is retried and then fails the recall with the transient message; a persistent failure fails at once with the persistent message.
- The recall benchmark (RFC 0003) on the dev set against the last run.

## Decision

1. Recall takes a `cue` and an optional, recommended `context`.
2. Association is not the agent's to switch; `associate` is removed.
3. The system sizes the result; `limit` is removed.
4. Recall is a flat list of stages that may add, drop, or reorder. The host takes text from the corpus, ORs `truncated`, and enforces a safety ceiling on the result. Nothing between stages is capped.
5. Each stage owns its bounds.
6. Only the output stage knows how many fragments a recall returns.
7. A judging stage judges everything it keeps, or retries and then fails with an error that says whether to retry.
8. `truncated` replaces `hasMore`. Stages report cuts a more specific cue can recover; the flag only goes up.
9. No transition; the input schema is strict.

Which stages run, and how each one matches, bounds, ranks, and judges, is a replaceable implementation of these decisions.
