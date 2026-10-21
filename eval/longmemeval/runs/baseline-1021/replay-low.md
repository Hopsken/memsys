# Recall replay, run `baseline-1021`

279 answer-time recalls from 60 questions, replayed against each question's saved memory. `as run` reproduced the recorded result exactly for 278 of 279 recalls. Jev at strictness `low`, timeout 1500 ms, up to 3 attempts. Regenerate with `RUN=baseline-1021 JEV_STRICTNESS=low pnpm exec vitest run --config eval/longmemeval/vitest.config.ts`.

Evidence found counts needed memories (as labeled for the run) that at least one recall of the question returned.

| Setup | Returned | Via anchors | Empty recalls | Evidence found | Jev failures | Median ms | p95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| as run (idf) | 2115 | 1518 | 95 | 92 | 0 | 5 | 22 |
| idf + jev | 1682 | 1085 | 95 | 94 | 0 | 164 | 286 |
| idf + jev (matches) | 1512 | 964 | 95 | 92 | 0 | 171 | 245 |

## Evidence lost against `as run`

None.
