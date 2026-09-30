# RFC 0002: Recall inputs, bounds, and `truncated`

- Status: Proposed
- Created: 2026-09-28
- Revised: 2026-09-29
- Discussion: pull request #51
- Implementation: pull request #50 implemented an earlier draft. A new pull request follows this revision.

## Summary

Recall is the read side of memsys. This RFC fixes its contract: what the agent sends, what it gets back, and what each signal in the result tells it to do next. It also decides where the bounds of the pipeline live, because those bounds decide what the result can promise.

- Recall takes a `cue` and, whenever the agent has one, a `context`. The `associate` and `limit` parameters go away.
- Every generating step is bounded before narrowing sees it. Narrowing handles everything it receives. Only the final truncation knows how many fragments a recall returns.
- Narrowing finishes or fails. A failure retries, then returns an explicit error that says whether trying again will help.
- The result carries `truncated`, replacing `hasMore`: relevant memories were left out that a more specific cue would reach.

How far recall spreads, how it picks what to keep, and how plugins rank are current policy, listed near the end. They can change without revisiting these decisions.

## Goal

memsys exists so that a capable agent keeps what a person tells it across a long working relationship, and the person never has to say it twice. Every decision below is judged against that goal through three costs:

- A **miss** costs a repeat. The person explains something again. This is the cost the product exists to remove.
- **Noise** costs tokens. The agent reads a fragment it did not need. A capable agent skips it and moves on.
- A **misleading result** costs trust. The agent believes it saw everything relevant, or believes a result was checked when it was not, and acts on that belief.

Misses are the most expensive and noise the cheapest. Whether a step uses a model is not a criterion. It is a means, judged like any other by these costs.

## Motivation

Before this RFC, recall took `cue`, `context`, `associate`, and `limit`, and returned `fragments` and `hasMore`. Several things went wrong around the last two inputs and the output signal.

- **The tool description was wrong.** It said `hasMore` meant "more fragments matched", but associations counted too. Two matches carrying a hub anchor such as `#work` kept `hasMore` true at any `limit` and with any cue, so neither remedy it suggested worked.
- **Jev turned `hasMore` into a false "you saw everything".** Jev judged at most 40 candidates and dropped the rest. With `matches` on (the default), at most 40 survived, so at `limit` 40 `hasMore` was always false, even with hundreds of matches.
- **Jev failed open.** A timeout, error, or malformed response returned the candidates unfiltered, and the agent read them as filtered. That is the trust cost: a misleading answer costs more than an error.
- **One Jev request could overflow its context.** Forty fragments at the 1000-character cap, in CJK text, can exceed Jev's 32k-token window, which then failed open silently.
- **`limit` leaked into generation.** Only the top `limit` matches seeded associations, so how far recall spread depended on the page size.
- **`limit` invited search-engine habits.** Agents set `limit` from habit, 5 or 10, the way they page a search API. Recall is not a search API: the agent does not know how many memories bear on its task, and a small `limit` cut off exactly the associations it did not know to ask for. The advice to raise it and retry reran the whole pipeline, Jev included, for results the first call could have returned.
- **`associate` asked the agent a question it cannot answer.** Turning association off is a claim that the agent already knows everything it needs. No known caller ever sent it.

## The model

Two kinds of thing are in memory for the agent:

- **Known unknowns.** Things the agent knows it needs and can name: "what did we decide about D1 regions?" The `cue` reaches these through the words they share.
- **Unknown unknowns.** Things that bear on the task but the agent would not think to ask for: a lesson from a similar mistake, a constraint set months ago. The agent cannot ask for these by name, because it does not know they exist. Association is how recall reaches them today: from what the cue found, it spreads along shared anchors to what sits nearby, the way a thought brings its neighbours with it. Spreading along other neighbourhoods, such as time or meaning, would be the same idea.

```
cue ──► starting points ──► spread ──► narrowing ──► output
        ╰─── generation (core today) ───╯ (plugins)     (truncate)
context ─────────────────────────────────┘
```

Generation decides what recall can reach: the cue's direct matches, then whatever spreading adds to them. Narrowing decides what is worth returning, judging against the cue and the context. The output decides how much the agent reads.

## Decisions

### 1. Recall takes what the agent knows: a cue and a context

`cue` is required: the words the agent has for what it needs. `context` is optional, but the tool asks for it whenever the agent has a task: what it is doing right now.

**Why.** A parameter should stand for something the caller knows and cares about. The agent knows what it is looking for and what it is doing. It does not know how memory is laid out, how many fragments match, or how far association should reach. A parameter for any of those asks it to guess, and in practice it guesses from habits formed on other tools.

`context` takes no part in matching today. It tells narrowing what "relevant" means for this call, and may later seed generation as well. Without it a relevance filter can judge only against the cue's words, so the description asks for it rather than leaving it as an afterthought.

### 2. Association is not the agent's to switch; `associate` is removed

**Why.** Association exists for unknown unknowns. An agent that turns it off asserts it has none, which is a judgment it is poorly placed to make. Whether spreading runs at all, how far, and how much of what it finds is kept are the instance's to decide, not the caller's: today spreading is a fixed step in core, and it may become a plugin the owner configures, as narrowing already is. Either way the agent sees no switch. The web client never sent `associate`, and no agent was observed to.

The one case that looked like a reason to turn it off, reading every fragment under an anchor such as `#must-read`, is enumeration, not recall: it wants every item, in order, with nothing added and nothing judged. That belongs to a listing tool (the planned memfs plugin), not to a switch on recall.

### 3. The system sizes the result; `limit` is removed

**Why.** The agent does not know how much it does not know, so it cannot choose a size. In practice it copies a habit, and the habit is small. A small `limit` shuts the association channel. A large one is close to what the system would have chosen anyway. The system knows how wide the spread was and how much narrowing kept, so it is better placed to size the result.

`RecallInput`, which plugins receive, drops `limit` too, so no plugin can behave differently by page size.

### 4. Generation is bounded before narrowing sees it

Each generating step, starting points and spread alike, has a fixed ceiling that the pipeline enforces. Today both steps and their ceilings live in core; if spreading moves into plugins, the host enforces the ceiling on what each adds. Narrowing never has to refuse work because generation produced too much, and the caller cannot widen or shrink a recall.

**Why.** A bound has to live somewhere. Placing it on generation keeps size logic out of narrowing plugins, which then only judge, and keeps size out of the caller's hands.

### 5. Only the output knows the size

The final truncation is the only step that reads how many fragments a recall returns. Generation and narrowing behave the same whatever that number is, so it can change without touching them.

### 6. Narrowing finishes or fails, and a failure says what to do

A narrowing plugin judges everything it receives. If it cannot, it retries within a deadline. If it still cannot, the recall fails with an error the agent can act on:

- A **transient** failure (a timeout, a gateway error, an unanswered candidate) says to try again shortly.
- A **persistent** failure (no balance, a model that is gone) says the memory's owner must act and that retrying will not help.

The cause goes to the log. Narrowing never stops early and never passes unchecked items through as checked.

**Why an error rather than a warning.** Agents reliably act on errors; a warning inside a successful result is easy to skip. A result plus a warning reads as a result: the agent is likely to take the unfiltered list as checked, which is the trust cost this RFC is here to remove. An error is unambiguous, and with retry in front of it, should be rare. Two error classes keep an agent from retrying into an empty balance.

**Why not stop early once the page is full.** It looks like a free optimization but is not: the result would depend on the page size (against decision 5), and any hook after it that reorders or drops items could then need what was never judged.

### 7. `truncated` replaces `hasMore`

The result carries `truncated: true` when relevant memories were left out that a more specific cue would reach:

- A cut to **starting points** sets it: too many fragments matched the cue.
- A cut at the **output** sets it: more relevant fragments survived narrowing than fit.
- A cut to the **spread** does not. It is forgetting: no cue change brings those fragments back through association, and counting them would make every hub anchor set the flag. They stay reachable by a cue that matches them directly, or by recalling the anchor.

The tool describes it as: some relevant memories were left out; use a more specific cue, or recall an anchor from `via`.

**Why a boolean and not a count.** A count has to count something: matches before narrowing, or survivors after. The first tells an agent, on an instance with Jev on, that 134 fragments exist that it "cannot see", when they are the ones judged irrelevant. The second changes meaning with the instance's plugins, so the same agent code reads it differently on different memories. And a number invites paging toward it. A boolean with one meaning and one remedy avoids all three.

**Why rename.** `hasMore` is the vocabulary of paged APIs and promises a cursor. Recall has none, and the remedy is not "call again" but "ask differently". `truncated` states what happened and leaves the remedy to the description.

### 8. No transition

The input schema is strict. A caller that sends `associate` or `limit` gets a validation error. Clients reconnect and re-read the tool schema.

**Why.** Ignoring the fields for a release would keep the old mental model alive in agents' descriptions of the tool, and the few connected clients are the owner's to reconnect.

## Current policy

This is how the code meets the decisions today. Any part can change on its own, measured with `pnpm eval`.

### Starting points

Direct matches, ordered by phrase match, then terms matched, then BM25, then newest. The first M are kept.

### Spread

- One hop along shared anchors, from every kept starting point. Association keys are anchors, split on `-` and stemmed for English words.
- Each key brings at most K associations, and all together at most A, newest first by `at`.

The per-key ceiling keeps a hub anchor from crowding out a rare one; a single recency cutoff across all keys would drop old fragments under rare anchors first. Newest first is a simple stand-in for association strength. More hops, or keeping associations by strength rather than age, would change only this section.

### Narrowing

Narrowing plugins run in registry order and may only reorder or drop. A hook for plugins that add candidates is not defined here.

- `idf` moves associations through rare anchors ahead of those through common ones. It does not drop.
- `jev` judges every candidate it is asked to, in batches of at most 40 candidates and 12,000 characters so each request fits Jev's 32k-token context even in CJK text, and sends the batches in parallel. A request that times out (10 s) or fails is retried once; the whole step has a deadline of 25 s. A Workers AI error that names a balance, a quota, or an unknown model is persistent; every other failure, including a malformed response or an unanswered candidate, is transient. Jev's default setting is not decided here.

### Output

The first N fragments in narrowed order. Today that puts direct matches before associations, so a recall with many strong matches crowds associations out; see the open questions.

### Values

| Ceiling | Value | Bounds                |
| ------- | ----- | --------------------- |
| M       | 200   | starting points       |
| K       | 20    | associations per key  |
| A       | 200   | associations in total |
| N       | 20    | returned fragments    |

Jev therefore judges at most 400 candidates per recall, in ten or more parallel requests.

### Development and tests

The dev server and tests use a fake Workers AI (`worker/dev/ai.ts`) in which Jev approves every candidate, so recall shows what core returns and nothing bills the account. `JEV=1 pnpm eval` runs the real model.

## Public contract

- MCP `recall` and `POST /api/recall` take `{ cue, context? }`. Sending `associate` or `limit` is a validation error.
- `cue` is described as: free text, one or a few words, a phrase, or #anchors; every word must appear in a match. Too few results: drop or change a word. Too many: add a word or a #anchor.
- `context` is described as: what you are doing right now, the task or the problem. Send it whenever you have one; it decides which related memories are worth returning. It does not take part in matching.
- `RecallResult` is `{ fragments, truncated, warnings? }`. `warnings` stays for adjusted requests; nothing sets it today.
- `RecallInput`, which plugins receive, is `{ cue, context }`.
- A recall returns up to N fragments, where the default was 10.
- A failed narrowing step returns an error whose text says whether to retry.
- The web recall preview drops "Show more" and shows exactly what the agent gets.

## Consequences

- On an instance with Jev on, a Workers AI outage that outlasts the retries fails recall until it passes. Every recall there bills Workers AI.
- Without Jev, a recall returns up to N fragments instead of 10, and noise per recall roughly doubles on the eval set. With Jev it is unchanged.
- Under the current spread policy, old fragments under busy anchors stop surfacing through association. They still surface through a direct cue.
- A recall's snapshot of the corpus lives as long as its Jev requests, so a fragment revised or forgotten meanwhile may come back in its earlier form.
- Architecture.md says plugins attach only at the terminal. That described the code, not a rule; it is reworded with the implementation, since `context` may later seed generation.

## Alternatives considered

### Keep `limit` as a pure output cap

Decisions 4 and 5 make `limit` harmless to the pipeline. It stays harmful to the agent, who sets it from habit and shuts the association channel. Its one honest use, a reading budget, is a judgment models make poorly today.

### Keep `limit` and fix the wording

The raise-and-retry loop stays, and `limit` still decides how far recall spreads.

### A count instead of a boolean

Covered under decision 7: we found no count with one meaning across instances, and a count invites paging.

### Fail open with a warning

Covered under decision 6: a result with a warning is read as a result.

### Cap inside Jev and throw past it

The filter would fail because the spread was large. Candidates that had already passed would be lost, and the error ("use a more specific cue") is wrong when a hub anchor, not the cue, caused the volume.

### Stop Jev once a page is full

Saves Jev calls, which are cheap and already bounded by generation, at the cost of decisions 5 and 6.

### A `more` flag in the `afterRecall` contract

This lets a filter that stops early report unfinished work. Under decision 6 no filter stops early, so the flag would widen the plugin contract for nothing.

### Pass Jev's unjudged tail through

Unchecked candidates would reach the agent as checked.

### Throw when starting points exceed M

This discards valid matches; a cut with `truncated` gives the same advice.

### Count spread cuts toward `truncated`

Hub anchors would keep the flag set, and no cue change recovers those associations.

### A list-by-tag tool for exhaustive reads

Enumeration is a different operation: paged, in order, with no spread and no narrowing. It is the planned memfs plugin's job, not a mode of recall.

### Ignore removed fields for a release

Covered under decision 8.

## Background

The shape is old. Recall as designed here corresponds to well-studied parts of human memory, which is some assurance that the parts fit together:

- **Cue matching** follows the encoding specificity principle (Tulving and Thomson, 1973): retrieval succeeds to the extent the cue overlaps what was encoded. This is also why the write path matters as much as the read path.
- **Spread along anchors** is spreading activation (Collins and Loftus, 1975; Anderson's ACT-R): activation flows from cued items to their neighbours.
- **Per-key ceilings and `idf`** follow the fan effect (Anderson, 1974) and the cue-overload principle (Watkins and Watkins, 1975): a cue shared by many items is a weak cue for each. `#work` is an overloaded cue.
- **`context`** is context-dependent retrieval (Godden and Baddeley, 1975; Howard and Kahana's temporal context model, 2002).
- **Association for unknown unknowns** is reminding (Schank, _Dynamic Memory_, 1982) and involuntary memory (Berntsen, 2009): the situation, not a search, brings the relevant episode back, and distinctive cues do it best.
- **Generation then narrowing** is the generate-recognize account of recall (Bahrick, 1970; Anderson and Bower, 1972), with narrowing as the monitoring stage of Koriat and Goldsmith (1996), where a confidence criterion trades quantity for accuracy. The same literature records the risk: a recognition stage can reject items that would have been recalled correctly, which is why a filter's default should be judged by what it misses.

What memsys does not do on its own, forgetting, consolidation, reweighting by use, is the slow system of complementary learning systems theory (McClelland, McNaughton, and O'Reilly, 1995). Those belong to plugins that propose changes through the core write tools; the core stores verbatim.

## Not in this RFC

- **`cue` as a list.** Letting one call carry several handles ("vite 403", "allowedHosts", "#vite") would save round trips and duplicate judging. It is additive and orthogonal to the decisions here; it can follow as an optimization.
- **Jev's default setting.** Whether Jev is on by default, and at which strictness, is decided by its miss rate on a larger eval set with contexts, not by noise. That is a separate discussion.
- **Enumeration.** Reading every fragment under an anchor is the planned memfs plugin's job.
- **Consolidation and decay.** A periodic pass by a stronger model that tidies memories, and any reweighting by use, are plugin-layer work that proposes writes through the core tools.
- **Spread along time.** Fragments written close together tend to belong together; spreading along `at` as well as anchors is a plugin for later.
- **Spread as a plugin.** Anchor spread itself may leave core and become the first of a family of plugins that add candidates, with a hook for adding, host-enforced ceilings, and a `via` that can carry reasons other than anchors. The decisions here are worded so that move needs no revisiting: the agent has no switch either way, generation stays bounded before narrowing, and only core's cuts set `truncated`.

## Open questions

- **Room for associations at the output.** Many strong matches crowd associations out of N. Whether to reserve a minimum share for associations, and how large, is undecided.
- **Spread cutoff by age or by strength.** Newest first buries old lessons under hub anchors, which are the ones a person is most likely to have to repeat. Cutting by `idf` weight or another strength instead would change only the spread section.
- The values of M, K, and A. The eval set, at 65 fragments, never reaches them.
- Jev's deadline and retry counts against its per-request timeout.
- How often Jev omits answers. Failing on an omission is only practical if omissions are rare.
- The character budget per Jev request. It needs a real call with long CJK fragments to confirm.

## Testing

- Pipeline: the full plugin registry sees every candidate and cuts only at the end.
- Core: a cut at M sets `truncated`; cuts at K and A do not.
- Current policy: every kept match seeds association; K keeps the newest per key.
- Input: `associate` and `limit` are rejected; `context` is optional.
- Jev: every candidate is judged whatever the output size; batches stay within budget; a transient failure is retried and then fails the recall with the transient message; a persistent failure fails at once with the persistent message; one failed batch fails the recall.
- `pnpm eval`, with and without `JEV=1`.

## Decision

1. Recall takes a `cue` and an optional, recommended `context`.
2. Association is not the agent's to switch; `associate` is removed.
3. The system sizes the result; `limit` is removed.
4. Generation is bounded before narrowing sees it; in core today.
5. Only the final truncation knows how many fragments a recall returns.
6. Narrowing judges everything it receives, or retries and then fails with an error that says whether to retry.
7. `truncated` replaces `hasMore`, set by cuts a more specific cue can recover: starting points and output, not spread.
8. No transition; the input schema is strict.

Everything under [Current policy](#current-policy) is a replaceable implementation of these decisions.
