# RFC 0002: Recall bounds and `hasMore`

- Status: Accepted
- Created: 2026-09-28
- Revised: 2026-09-29
- Discussion: pull request #50

## Summary

Recall generates candidates (starting points from the cue, then a spread along shared anchors), narrows them with plugins, and returns the result. This RFC decides where the bounds live and what `hasMore` means:

- Generation bounds its own output in core. Narrowing handles everything it receives. The caller sets no size, and the agent-facing `limit` parameter goes away.
- Only the final truncation knows how many fragments a recall returns.
- Narrowing finishes or fails; it never passes unchecked memories off as checked.
- `hasMore` has one meaning with one remedy: relevant memories were left out that a more specific cue would reach.

How far recall spreads, how it picks what to keep, and how plugins rank are current policy. They can change without revisiting these decisions.

## Motivation

Before this RFC, `hasMore` was `true` when more candidates survived the plugins than `limit`. Several things broke around it:

- **The tool description was wrong.** It said `hasMore` meant "more fragments matched", but associations counted too. Two matches carrying a hub anchor such as `#work` kept `hasMore` true at any `limit` and with any cue, so neither remedy it suggested worked.
- **Jev turned `hasMore` into a false "you saw everything".** Jev judged at most 40 candidates and dropped the rest. With `matches` on (the default), at most 40 survived, so at `limit` 40 `hasMore` was always false, even with hundreds of matches.
- **Jev failed open.** A timeout, error, or malformed response returned the candidates unfiltered, and the agent read them as filtered. Agent tokens cost far more than Jev calls, and a misleading answer costs more than an error.
- **One Jev request could overflow its context.** Forty fragments at the 1000-character cap, in CJK text, can exceed Jev's 32k-token window, which then failed open silently.
- **`limit` leaked into generation.** Only the top `limit` matches seeded associations, so how far recall spread depended on the page size.
- **`limit` made agents recall twice.** The advice was to raise `limit` when `hasMore` was set, which reran the whole pipeline, Jev included, for results the first call could have returned.

## The model

```
cue ──► starting points ──► spread ──► narrowing ──► output
        ╰──── generation (core) ────╯   (plugins)     (truncate)
```

This mirrors associative memory: a cue activates what matches it, activation spreads along shared anchors, and relevance keeps what helps. Generation decides what recall can reach, narrowing decides what is worth returning, and the output decides how much the agent reads.

## Decisions

### 1. Generation bounds its own output

Each generating step, starting points and spread alike, has a fixed ceiling in core. Narrowing never has to refuse work because generation produced too much, and the caller cannot widen or shrink a recall.

### 2. Only the output knows the size

The final truncation is the only step that reads how many fragments a recall returns. Generation and narrowing behave the same whatever that number is, so it can change without touching them.

### 3. Narrowing finishes or fails

A narrowing plugin judges everything it receives. If it cannot, the recall fails with an error that tells the caller what to do; the cause goes to the log. It never stops early and never passes unchecked items through.

Stopping early looks like a free optimization but is not: the result would depend on the page size (against decision 2), and any hook after it that reorders or drops items could then need what was never judged.

### 4. `hasMore` counts only what a more specific cue can recover

- A cut to **starting points** sets `hasMore`: the cue was too broad.
- A cut at the **output** sets `hasMore`: more relevant fragments survived than fit.
- A cut to the **spread** does not. It is forgetting: no cue change brings those fragments back through association, and counting them would make every hub anchor set `hasMore`. They stay reachable by a cue that matches them directly, or by recalling the anchor.

The recall tool describes `hasMore` as: relevant memories were left out; use a more specific cue, or recall an anchor from `via`.

### 5. No `limit`

MCP `recall` and `POST /api/recall` drop `limit`, and `RecallInput`, which plugins receive, drops it too.

## Current policy

This is how the code meets the decisions today. Any part can change on its own, measured with `pnpm eval`.

### Starting points

Direct matches, ordered by phrase match, then terms matched, then BM25, then newest. The first M are kept.

### Spread

- One hop along shared anchors, from every kept starting point. Association keys are anchors, split on `-` and stemmed for English words.
- Each key brings at most K associations, and all together at most A, newest first by `at`.

The per-key ceiling keeps a hub anchor from crowding out a rare one; a single recency cutoff across all keys would drop old fragments under rare anchors first. Newest first is a simple stand-in for association strength. More hops, or keeping associations by strength rather than age, would change only this section.

### Narrowing

Plugins run in registry order and may only reorder or drop.

- `idf` moves associations through rare anchors ahead of those through common ones. It does not drop.
- `jev` is on by default. It judges every candidate it is asked to, in batches of at most 40 candidates and 12,000 characters so each request fits Jev's 32k-token context even in CJK text, and sends the batches in parallel. A timeout (10 s per request), binding error, empty balance, malformed response, or unanswered candidate fails the recall.

### Output

The first N fragments in narrowed order. Today that puts direct matches before associations, so a recall with many strong matches crowds associations out.

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

- A caller that still sends `limit` gets a validation error; the input schema is strict. MCP clients re-read tool schemas each session.
- `RecallResult` keeps its shape. The capped-`limit` warning disappears; `warnings` stays for future use.
- A recall returns up to N fragments, where the default was 10.
- The web recall preview drops "Show more" and shows exactly what the agent gets.

## Consequences

- Jev is on by default and fails closed, so a Workers AI outage or an empty balance fails recall on every instance that has not turned it off. Every production recall bills Workers AI.
- Without Jev, a recall returns up to N fragments instead of 10, and noise per recall roughly doubles on the eval set. With Jev it is unchanged.
- Old fragments under busy anchors stop surfacing through association. They still surface through a direct cue.
- A recall's snapshot of the corpus lives as long as its Jev requests, so a fragment revised or forgotten meanwhile may come back in its earlier form.

## Alternatives considered

### Keep `limit` and fix the wording

The raise-and-retry loop stays, and `limit` still decides how far recall spreads.

### Cap inside Jev and throw past it

The filter would fail because the spread was large. Candidates that had already passed would be lost, and the error ("use a more specific cue") is wrong when a hub anchor, not the cue, caused the volume.

### Stop Jev once a page is full

Saves Jev calls, which are cheap and already bounded by generation, at the cost of decisions 2 and 3.

### A `more` flag in the `afterRecall` contract

This lets a filter that stops early report unfinished work. Under decision 3 no filter stops early, so the flag would widen the plugin contract for nothing.

### Pass Jev's unjudged tail through

Unchecked candidates would reach the agent as checked.

### Throw when starting points exceed M

This discards valid matches; a cut with `hasMore` gives the same advice.

### Count spread cuts toward `hasMore`

Hub anchors would keep `hasMore` set, and no cue change recovers those associations.

### Keep Jev fail-open

Unfiltered results look filtered, which misleads the agent.

## Open questions

- The values of M, K, and A. The eval set, at 65 fragments, never reaches them.
- An overall deadline for Jev. Its requests run in parallel, but one slow request still holds the recall for up to 10 s.
- How often Jev omits answers. Failing on an omission is only practical if omissions are rare.
- The character budget per Jev request. It needs a real call with long CJK fragments to confirm.

## Testing

- Pipeline: the full plugin registry sees every candidate and cuts only at the end.
- Core: a cut at M sets `hasMore`; cuts at K and A do not; every kept match seeds association; K keeps the newest per key.
- Jev: every candidate is judged whatever the output size, batches stay within budget, and every failure case, including one failed batch, fails the recall.
- `pnpm eval`, with and without `JEV=1`.

## Decision

1. Generation bounds its own output in core; the caller sets no size.
2. Only the final truncation knows how many fragments a recall returns.
3. Narrowing judges everything it receives, or fails the recall.
4. `hasMore` is set by cuts a more specific cue can recover: starting points and output, not spread.
5. The `limit` parameter is removed.

Everything under [Current policy](#current-policy) is a replaceable implementation of these decisions.
