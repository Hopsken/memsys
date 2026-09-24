# Short memories (`size-limit`)

Keeps each fragment to one short idea. Checks `remember` and `revise`.

| Setting | Default | Effect |
| --- | --- | --- |
| Warn above (`soft`) | 300 | Longer fragments are stored with a warning asking the agent to split them. |
| Refuse above (`hard`) | 500 | Longer fragments are rejected; nothing is stored. |

Length is counted in grapheme clusters (`lib/fragment.ts`), the same way core counts its own ceiling of 1000. Neither setting may exceed that ceiling, and `soft` may not exceed `hard`. Warnings and rejections state the actual length and limit, so the agent can fix the fragment in one retry.
