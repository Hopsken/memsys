# Features

What memsys does on top of storing and matching memories, and which parts the owner can change under **Settings → Features**. The settings are one object (`contract/settings.ts`, parsed in `worker/services/settings.ts`); why there are no plugins is in [RFC 0004](rfcs/0004-memory-core.md).

| Feature                | Setting                        | Default  |
| ---------------------- | ------------------------------ | -------- |
| Short memories         | `length.warn`, `length.refuse` | 300, 500 |
| Relevance filter (Jev) | `relevanceFilter`              | `off`    |
| Specific links first   | always on                      |          |
| Tag list (`list_tags`) | always on                      |          |

## Short memories

Keeps each fragment to one short idea. Checks `remember` and `revise`; import is not checked.

| Setting | Default | Effect |
| --- | --- | --- |
| Warn above (`length.warn`) | 300 | Longer fragments are stored with a warning asking the agent to split them. |
| Refuse above (`length.refuse`) | 500 | Longer fragments are rejected; nothing is stored. |

Length is counted in grapheme clusters (`lib/fragment.ts`), the same way core counts its own ceiling of 1000. Neither setting may exceed that ceiling, and `warn` may not exceed `refuse`; both at 1000 turn the limits off. Warnings and rejections state the actual length and limit, so the agent can fix the fragment in one retry.

## Relevance filter (Jev)

Asks [Jev](https://developers.cloudflare.com/ai/models/typesafe/jev/), a small judgment model on Workers AI, whether each recalled fragment helps with the agent's cue and `context`, and hides the ones it rules out (`RecallService.filter` in `worker/services/recall.ts`; the Workers AI call is `worker/clients/jev.ts`). Runs after ranking. Uses Workers AI credits and adds about a second per recall.

`relevanceFilter` is `off` or how much to hide: `low` 0.1, `medium` 0.3, `high` 0.5, `max` 0.7. A fragment is hidden when Jev's probability that it helps falls below the level. On real recalls, misses scored about 0.15 or lower and hits about 0.9, which is where the levels come from.

### Behavior

- One request per recall, with one yes/no (`noul`) question per fragment, cue matches included. The state holds the cue, the context, and the fragment texts; question keys are refs.
- At most `JUDGE_BUDGET` (40) fragments are judged. Fragments past it are dropped, not passed on unjudged; if a dropped one matched the cue, the result is `truncated`.
- Order is unchanged. Every fragment it keeps was judged.
- The Workers AI binding returns Jev's body inside a gateway envelope (`{ state, result: { answers } }`); the filter also accepts the bare body the model docs show.

### Failure

The filter never fails open: an unfiltered list would read as a checked one. Each failed attempt logs `jev.attempt.failed`.

- **Transient** — a timeout (1.5 s per attempt), a Workers AI error with any other code (such as `3040`, out of capacity), an `InferenceUpstreamError`, or a fragment left unanswered. Jev tries up to `JEV_ATTEMPTS` (3) times, waiting 250 ms, then 500 ms; a retry asks only about fragments still unanswered. Then the recall fails with `retry: true`: HTTP 503 with `Retry-After`, and a message that says to retry shortly.
- **Persistent** — Workers AI codes that retrying cannot fix: `3036` (no balance), `5007` and `3042` (no such model), and the account and plan errors `3023`, `3041`, `5016`, `5018`, `5035`. Also any error with no Workers AI code, such as a missing binding, and a response that never parses on any attempt, which means the model changed. The recall fails at once with `retry: false`: HTTP 502, and a message that says the owner can turn the filter off. The web preview shows the message and no retry button.

Error messages never carry the Workers AI error: the service pays for Workers AI, so neither the agent nor the owner can act on it. The cause goes to the log, as `jev.unavailable` for a persistent failure and `jev.attempt.failed` for each failed attempt.

### Development

The `AI` binding is always remote, so local dev bills the account. Tests set `remoteBindings: false` and pass a fake `ai`, so they need no Cloudflare credentials.

## Specific links first

Ranks associated fragments by how specific their link is, so hub anchors like `#work` stop crowding out rare, meaningful ones (`rankAssociations` in `worker/services/recall.ts`).

- Each anchor weighs `ln((N+1)/(df+1))`, where `N` is the corpus size and `df` the number of fragments carrying it: high for rare anchors, near zero for hubs.
- An associated fragment scores the sum of the weights of its `via` anchors. Higher scores come first.
- Cue matches keep their place at the top. Ties keep recency order.
- `df` counts anchors literally, without the stemming association uses. The core keeps the counts up to date as fragments are written.

On the test corpus, recalling "US West" lifts f7 (shares the rare `#d1`) above f4 and f6 (share only the `#memsys` hub).

## Tag list

The `list_tags` tool returns every `#anchor` in use, lowercase, sorted, without counts. Agents call it before writing so they reuse existing tags instead of inventing near-duplicates. Agents with `memory:read` see it.
