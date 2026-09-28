# RFC 0002: Recall bounds and `hasMore`

- Status: Proposed
- Created: 2026-09-28

## Summary

Recall is four stages: the cue finds starting points, anchors spread one hop from them, plugins narrow the result, and the output is returned. Each stage bounds its own output with a fixed ceiling in core. The agent-facing `limit` parameter goes away.

`hasMore` gets one meaning with one remedy: relevant memories were left out that a more specific cue would reach. Jev judges everything it receives and fails the recall rather than return unchecked memories.

## Motivation

Today `hasMore` is `true` when more candidates survive the plugins than `limit`. Several things break around it:

- **The tool description is wrong.** It says `hasMore` means "more fragments matched", but associations count too. Two matches carrying a hub anchor such as `#work` keep `hasMore` true at any `limit` and with any cue, so neither remedy it suggests works.
- **Jev turns `hasMore` into a false "you saw everything".** Jev judges at most 40 candidates and drops the rest. With `matches` on (the default), at most 40 survive, so at `limit` 40 `hasMore` is always false, even with hundreds of matches.
- **Jev fails open.** A timeout, error, or malformed response returns the candidates unfiltered, and the agent reads them as filtered. Agent tokens cost far more than Jev calls, and a misleading answer costs more than an error.
- **One Jev request can overflow its context.** Forty fragments at the 1000-character cap, in CJK text, can exceed Jev's 32k-token window, which then fails open silently.
- **`limit` leaks into earlier stages.** Only the top `limit` matches seed associations, so how far recall spreads depends on the page size.
- **`limit` makes agents recall twice.** The advice is to raise `limit` when `hasMore` is set, which reruns the whole pipeline, Jev included, for results the first call could have returned.

## The model

```
cue ──► starting points ──► spread ──► narrow ──► output
        direct matches      one hop     plugins     what the
                            via anchors drop/reorder agent reads
```

This mirrors associative memory: a cue activates what matches it, activation spreads along shared anchors, and relevance keeps what helps. Everything else must preserve this shape:

1. **Each stage bounds its own output.** A later stage never fails because an earlier one produced too much.
2. **Only the output stage knows the page size.** Nothing earlier depends on it.
3. **A narrowing stage finishes or fails.** It never passes unchecked items off as checked.
4. **A cut counts toward `hasMore` only if a more specific cue could recover what it cut.**

## Design

### Starting points: at most M direct matches

Direct matches keep their order: phrase matches, then terms matched, then BM25, then newest. Core keeps the first M.

More than M matches means the cue is too broad. The weakest matches are cut and `hasMore` is set. Throwing instead would discard the strongest matches for no gain, since `hasMore` gives the same advice.

### Spread: one hop from every kept match

- Every kept match seeds association, not only the first `limit`.
- Each association key (an anchor, or the stemmed part of one that association already matches on) brings at most K associations, newest first by `at`.
- All associations together are capped at A, newest first.

These cuts are forgetting, not overflow: they do not set `hasMore`. A more specific cue cannot bring them back, and counting them would make every hub anchor set `hasMore` again. Forgotten associations stay reachable: a cue that matches them directly, or a recall of the anchor itself, finds them.

The cap is per key rather than a global recency cutoff. Under a global cutoff, new fragments under a hub anchor would crowd out old ones under a rare anchor, and those are the associations `idf` ranks highest. `idf` itself only reorders, so it cannot bound volume.

### Narrowing: plugins

`afterRecall` hooks keep their contract: they may only reorder or drop. `RecallInput` loses `limit`.

Jev:

- Judges candidates in order, in sequential requests. Each request stays under a character budget that fits Jev's context window even in CJK text.
- Has no cap of its own. Upstream bounds its work to M + A candidates.
- Stops once more than N candidates are kept and drops the unjudged rest. This returns exactly what judging everything and then cutting to N would, as long as no hook after Jev drops items. The registry keeps Jev last among dropping hooks.
- Fails closed. A timeout, binding error, empty balance, malformed response, or unanswered candidate throws `PluginAbortError`. The error says what the caller can do (try again later), not which plugin failed.

### Output: at most N

Direct matches come first, then associations, cut to N. A cut here sets `hasMore`.

```
hasMore = direct matches were cut at M || more than N survived narrowing
```

When direct matches fill the output, associations are crowded out. That is intended, since direct matches are the stronger signal. The recall tool description says: `hasMore` means relevant memories were left out; use a more specific cue, or recall an anchor from `via`.

### Starting values

| Ceiling | Value | Bounds                |
| ------- | ----- | --------------------- |
| M       | 200   | direct matches        |
| K       | 20    | associations per key  |
| A       | 200   | associations in total |
| N       | 20    | returned fragments    |

Jev therefore judges at most 400 candidates per recall. `pnpm eval` sets the final values.

## Public contract

- MCP `recall` and `POST /api/recall` drop `limit`. The input schema is strict, so a caller that still sends `limit` gets a validation error. MCP clients re-read tool schemas each session.
- `RecallResult` keeps its shape. The capped-`limit` warning disappears; `warnings` stays for future use.
- `RecallInput`, which plugins receive, drops `limit`.
- A recall returns up to N fragments, where the default was 10.
- The web recall preview drops "Show more" and shows exactly what the agent gets.

## Consequences

- Without Jev, a recall returns up to N fragments instead of 10, so more noise reaches the agent per call.
- Old fragments under busy anchors stop surfacing through association. They still surface through a direct cue.
- With Jev enabled, recall can fail: during outages, when the Workers AI balance is empty, or when Jev omits an answer. With Jev disabled, failure behavior is unchanged.
- A Jev recall may take several sequential requests. A recall's snapshot of the corpus lives longer, so a fragment revised or forgotten mid-recall may come back in its earlier form.
- The eval baseline, reported at `limit` 10, must be regenerated.

## Alternatives considered

### Keep `limit` and fix the wording

The raise-and-retry loop stays, and `limit` still decides how far recall spreads.

### Cap inside Jev and throw past it

The filter would fail because the spread was large. Candidates that had already passed would be lost, and the error ("use a more specific cue") is wrong when a hub anchor, not the cue, caused the volume.

### A `more` flag in the `afterRecall` contract

This lets a filter that stops early report unfinished work. With upstream ceilings, Jev always finishes, so the flag would widen the plugin contract for nothing.

### Pass Jev's unjudged tail through

Unchecked candidates would fill the page whenever fewer than N passed.

### Throw when direct matches exceed M

This discards valid matches; a cut with `hasMore` gives the same advice.

### Count association cuts toward `hasMore`

Hub anchors would keep `hasMore` set, and no cue change recovers those associations.

### Keep Jev fail-open

Unfiltered results look filtered, which misleads the agent.

## Open questions

- Values of M, K, A, and N, from `pnpm eval`.
- An overall deadline for Jev. The worst case is about 20 requests at 10 s each, which is longer than common MCP client timeouts; a deadline would turn that into a clear error.
- How often Jev omits answers. Failing on an omission is only practical if omissions are rare.
- The character budget per Jev request. It needs a real call with long CJK fragments to confirm.

## Testing

- Pipeline: the full plugin registry sees every candidate and cuts only at the end (exists).
- Core: a cut at M sets `hasMore`; cuts at K and A do not; every kept match seeds association; K keeps the newest per key.
- Jev: batches stay within budget, judging stops once more than N are kept, and every failure case aborts the recall.
- `pnpm eval`, with and without `JEV=1`.

## Decision

1. Recall is starting points, spread, narrowing, and output, and each stage bounds its own output.
2. The `limit` parameter is removed; core returns at most N fragments.
3. Direct matches are capped at M, and a cut sets `hasMore`.
4. Every kept match seeds association. Associations are capped at K per key and A in total, newest first, and these cuts do not set `hasMore`.
5. `hasMore` means a more specific cue would reach relevant memories that were left out.
6. Jev judges everything it receives, in batches within its context window, and fails closed.
