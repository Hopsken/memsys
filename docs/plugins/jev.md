# Relevance filter (`jev`)

Asks [Jev](https://developers.cloudflare.com/ai/models/typesafe/jev/), a small judgment model on Workers AI, whether each recalled fragment helps with the agent's cue and `context`, and hides the ones it rules out. Off by default. Runs after `idf`. Uses Workers AI credits and adds up to about a second per recall.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Check direct matches (`matches`) | off | Also judge fragments that match the cue. Off judges associations only. |
| Strictness (`strictness`) | medium | How much to hide: `low` 0.1, `medium` 0.3, `high` 0.5, `max` 0.7. A fragment is hidden when Jev's probability that it helps falls below the level. |

On real recalls, misses scored about 0.15 or lower and hits about 0.9, which is where the levels come from. Configs saved with the earlier numeric `threshold` still load, as `medium`.

## Behavior

- One request per recall, with one yes/no (`noul`) question per judged fragment. The state holds the cue, the context, and the fragment texts; question keys are refs.
- At most `RECALL_LIMIT_MAX` fragments are judged, so a full page can always be model-approved. Judged candidates past that cap are dropped, not passed through unjudged.
- Order is unchanged. Fragments Jev leaves unanswered are kept.
- The Workers AI binding returns Jev's body inside a gateway envelope (`{ state, result: { answers } }`); the plugin also accepts the bare body the model docs show.

## Failure

Fail-open: a timeout (1.5 s), binding error, empty balance, or malformed response leaves recall as it would be without the plugin, and logs `plugin.hook.failed`. No retries.

## Development

The `AI` binding is always remote, so local dev bills the account. Tests set `remoteBindings: false` and inject a fake `ai`, so they need no Cloudflare credentials.
