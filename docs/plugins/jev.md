# Relevance filter (`jev`)

Asks [Jev](https://developers.cloudflare.com/ai/models/typesafe/jev/), a small judgment model on Workers AI, whether each recalled fragment helps with the agent's cue and `context`, and hides the ones it rules out. Off by default. Runs after `idf`. Uses Workers AI credits and slows recall.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Check direct matches (`matches`) | on | Also judge fragments that match the cue. Off judges associations only. |
| Strictness (`strictness`) | medium | How much to hide: `low` 0.1, `medium` 0.3, `high` 0.5, `max` 0.7. A fragment is hidden when Jev's probability that it helps falls below the level. |

On real recalls, misses scored about 0.15 or lower and hits about 0.9, which is where the levels come from. Configs saved with the earlier numeric `threshold` still load, as `medium`.

## Behavior

- Candidates are judged in order, 20 per request, with one yes/no (`noul`) question each. The state holds the cue, the context, and the fragment texts; question keys are refs. Twenty fragments at the 1000-character cap fit Jev's 32k-token context even in CJK text.
- Judging stops once more than `limit` fragments are kept, so `hasMore` is exact; candidates never judged are dropped, never passed through.
- Order is unchanged.
- The Workers AI binding returns Jev's body inside a gateway envelope (`{ state, result: { answers } }`); the plugin also accepts the bare body the model docs show.

## Failure

Fail-closed: an unfiltered result misleads the agent, which costs more than an error. A timeout (10 s per request), binding error, empty balance, malformed response, or unanswered candidate fails the recall with `jev: Couldn't check relevance: …`. No retries.

If 400 candidates are judged without filling a page, recall fails and asks for a more specific cue.

## Development

The `AI` binding is always remote, so local dev bills the account. Tests set `remoteBindings: false` and inject a fake `ai`, so they need no Cloudflare credentials.
