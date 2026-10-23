# Relevance filter (`jev`)

Asks [Jev](https://developers.cloudflare.com/ai/models/typesafe/jev/), a small judgment model on Workers AI, whether each recalled fragment helps with the agent's cue and `context`, and hides the ones it rules out. Off by default. Runs after `idf`. Uses Workers AI credits and adds about a second per recall.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Strictness (`strictness`) | medium | How much to hide: `low` 0.1, `medium` 0.3, `high` 0.5, `max` 0.7. A fragment is hidden when Jev's probability that it helps falls below the level. |

On real recalls, misses scored about 0.15 or lower and hits about 0.9, which is where the levels come from. Configs saved with the earlier numeric `threshold` still load, as `medium`; the earlier `matches` switch is ignored.

## Behavior

- One request per recall, with one yes/no (`noul`) question per fragment, cue matches included. The state holds the cue, the context, and the fragment texts; question keys are refs.
- At most `JEV_BUDGET` (40) fragments are judged. Fragments past it are dropped, not passed on unjudged; if a dropped one matched the cue, the result is `truncated`.
- Order is unchanged. Every fragment it keeps was judged.
- The Workers AI binding returns Jev's body inside a gateway envelope (`{ state, result: { answers } }`); the plugin also accepts the bare body the model docs show.

## Failure

Jev never fails open: an unfiltered list would read as a checked one. Each failed attempt logs `jev.attempt.failed`.

- **Transient** — a timeout (1.5 s per attempt), a Workers AI error with any other code (such as `3040`, out of capacity), an `InferenceUpstreamError`, or a fragment left unanswered. Jev tries up to `JEV_ATTEMPTS` (3) times, waiting 250 ms, then 500 ms; a retry asks only about fragments still unanswered. Then the recall fails with `retry: true`: HTTP 503 with `Retry-After`, and a message that says to retry shortly.
- **Persistent** — Workers AI codes that retrying cannot fix: `3036` (no balance), `5007` and `3042` (no such model), and the account and plan errors `3023`, `3041`, `5016`, `5018`, `5035`. Also any error with no Workers AI code, such as a missing binding, and a response that never parses on any attempt, which means the model changed. The recall fails at once with `retry: false`: HTTP 502, and a message that says the owner must act. The web preview shows the message and no retry button.

## Development

The `AI` binding is always remote, so local dev bills the account. Tests set `remoteBindings: false` and inject a fake `ai`, so they need no Cloudflare credentials.
