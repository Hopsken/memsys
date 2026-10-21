# Recall replay, run `baseline-1021`

279 answer-time recalls from 60 questions, replayed against each question's saved memory. `as run` reproduced the recorded result exactly for 278 of 279 recalls. Jev at strictness `medium`, timeout 1500 ms, up to 3 attempts. Regenerate with `RUN=baseline-1021 pnpm exec vitest run --config eval/longmemeval/vitest.config.ts`.

Evidence found counts needed memories (as labeled for the run) that at least one recall of the question returned.

| Setup | Returned | Via anchors | Empty recalls | Evidence found | Jev failures | Median ms | p95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| as run (idf) | 2115 | 1518 | 95 | 92 | 0 | 4 | 18 |
| idf + jev | 985 | 388 | 95 | 92 | 0 | 174 | 291 |
| idf + jev (matches) | 805 | 352 | 97 | 93 | 0 | 172 | 253 |

## Evidence lost against `as run`

- idf + jev: 2c63a862 s99hrzg
- idf + jev: a89d7624 h8m7bwh
