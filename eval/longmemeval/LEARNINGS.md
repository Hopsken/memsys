# What each run taught us

Runs cost real money, so every finding is written down here, newest first, with the evidence to check it against. Numbers come from the run's files in `runs/<name>/`; the commands that produce them are under each run.

## Open fixes

Found by baseline-1021 and its full-context control; not started. Each names the evidence and the cheapest run that would show the fix working.

1. **Store what the assistant produced.** Recommendations, lists, and content the assistant wrote are almost never stored (2 single-session-assistant misses; about 49 of 14,236 records). Change: server instructions and the `remember` description. Check: rewrite S ($6.5).
2. **Keep specifics.** A fragment kept the coupon's amount and date but dropped the store. Same change and check as 1.
3. **Revise instead of adding beside.** 303 `revise` against 13,883 `remember`; a new value is stored next to the old one and answers hedge. Change: instructions, `remember` and `revise` descriptions. Check: rewrite S, knowledge-update questions.
4. **Empty recalls on keyword-bag cues.** 34% of answer-time recalls return nothing (56% at 4+ words). Change: BM25 ranking over any cue term when the AND match is empty or thin, or a clearer cue contract. Check: offline replay of the 279 recorded cues ($0), then the answer step only ($0.15).
5. **Association noise.** 72% of returned fragments came through `via`; only 4 of 92 returned evidence fragments came through `via` alone. Jev replay done (section 6): at `medium` it removes about 75% of associated fragments but dropped 2 of those 4; at `low` it removes about 30% and dropped none. Next check: the answer step with Jev on ($0.15), and a second replay for Jev's stability.
6. **Harness.** Add a "stale fact" stage to `report.ts`; label evidence against the answer sessions, not the whole memory; add "answer only against another run's memory".
7. **Scale.** S fits in a 1M context, so full context ties memsys. Run a small LongMemEval_M sample (about $25 for 2 per type) after 1 to 3 land.

## baseline-1021 (2026-10-21)

60 questions (10 per type), Pi 1.3, `deepseek/deepseek-flash` at thinking `medium` for agent and judge, memsys at [`5b8a0ab`](https://github.com/Hopsken/memsys/commit/5b8a0ab). **53/60 correct (88%), $6.45, 70 minutes at concurrency 10.** No Pi or DeepSeek errors.

| Type                      | Correct |
| ------------------------- | ------- |
| multi-session             | 10/10   |
| temporal-reasoning        | 10/10   |
| single-session-user       | 9/10    |
| knowledge-update          | 8/10    |
| single-session-preference | 8/10    |
| single-session-assistant  | 8/10    |

### 1. Writing loses more answers than recall does

Of the 7 wrong answers, read by hand, only one is a recall miss, and lexical recall could not have caught it:

| Question | Cause | Stage |
| --- | --- | --- |
| 488d3006 | The trail the assistant recommended (GR-90) was never stored | write |
| eaca4986 | The chord progression the assistant wrote was never stored | write |
| 51a45a95 | Memory says a $5 creamer coupon was redeemed, but not where (Target) | write |
| a2f3aa27 | Follower counts 1,250 and "close to 1,300" both stored the same day; the older one was not revised | write (stale fact) |
| 031748ae_abs | The user's title was Senior Software Engineer; the agent answered for "Software Engineer Manager" instead of flagging the false premise | answer |
| 1a1907b4 | Every needed memory came back; the agent asked a question instead of suggesting cocktails | answer |
| 75832dbd | Cue `research interests conferences`; the memories say "deep learning for medical image analysis" and "XAI", sharing no word | recall (semantic gap) |

What the writer misses, in order of cost:

- **Content the assistant produced.** Both single-session-assistant misses. Of 14,236 stored records, about 49 record something the assistant recommended or wrote; 9,695 start with "User …". The instructions and `remember` description only talk about facts about the user.
- **Specifics inside an event.** The coupon fragment kept the amount and the date and dropped the store.
- **Superseded facts.** `revise` ran 303 times against 13,883 `remember` calls. A new value is usually stored beside the old one, and the answer then hedges between them (07741c45 in the pilot, a2f3aa27 here).

So the next lever is the write-side text (server instructions, `remember` and `revise` descriptions), not ranking.

### 2. Agents write cues as keyword bags; recall reads them as AND

Recall requires every cue word (one may be missing at three or more). Agents send lists of alternatives and get nothing back:

| Cue words | Recalls while answering | Empty    |
| --------- | ----------------------- | -------- |
| 1         | 67                      | 4 (6%)   |
| 2         | 48                      | 18 (38%) |
| 3         | 64                      | 17 (27%) |
| 4+        | 100                     | 56 (56%) |

95 of 279 answer-time recalls (34%) returned nothing. Typical empty cues: `exercise reading cooking music friends`, `#knitting #yoga #guitar #painting`, `evening activities hobbies`. The agent recovers by trying again, so accuracy hides it; the cost is turns and tokens, with outliers of 37, 24, and 20 recalls on one question (gpt4_7fce9456, 195a1a1b, gpt4_fa19884d). Many anchors in one cue are clearly meant as OR.

This is the concrete case for BM25 as a fallback: when the AND match is empty or thin, rank by BM25 over any cue term instead of returning nothing. It can be tested offline on these 279 recorded cues against the saved `memory.ndjson`, at no model cost. The alternative is to say AND louder in the tool description; the data says agents do not read it that way today.

### 3. Costs and how to spend less next time

- Writing is 98% of the cost ($6.32 of $6.45): 2,879 sessions at $0.0022 and 8.6 s each. Answering 60 questions cost $0.13; judging is a few cents.
- The pilot estimate held: 6 questions predicted $6.5 for 60; actual $6.45.
- Writes are heavy: about 4.8 `remember` calls per session, 230 memories per question, 185 characters each; 113 sessions (4%) stored nothing. The agent also called `recall` in 1,996 of 2,879 write sessions and `list_tags` 698 times.
- So: **change only the answer side whenever possible.** A change to recall, ranking, or the `recall` description reuses this run's memories (`memory.ndjson`) and needs only the answer and judge steps, about $0.15. A change to anything the writer reads (instructions, `remember`/`revise` text, write plugins, model) needs a full $6.5 rewrite.
- The size-limit plugin rejected 25 writes over 500 characters; the agent split and retried. Harmless, but it is the only tool error seen.

### 4. The harness

- `report.ts` stages are leads, not measurements. Two of seven were wrong: 51a45a95 showed as "partly retrieved" because the evidence labeler counted an inferred memory (a Target app note) as needed; 07741c45-style stale facts show as "not used". A "stale fact" stage, and labeling evidence against the answer sessions rather than the whole memory, would fix both.
- The judge is the same model as the agent. Scores are not comparable with LongMemEval's published GPT-4o-judged numbers.
- A tool call cancelled in the UI may still have run: the `lme-baseline` service had started before the cancel. Check `amp orb service list` before starting a run again.
- DeepSeek accepts only the `deepseek-flash` alias (not `deepseek-v4.1-flash-1017`); the fingerprint `e72d3c7f663d3e1383b00b3884cb4501` records the version.

### 5. Full context ties memsys on LongMemEval_S

Control run (`full-context.ts`, [full-context.md](runs/baseline-1021/full-context.md)): the same 60 questions, the same model with thinking on, every session in one prompt (about 105k tokens), LongMemEval's own full-context prompt, the same judge. **Full context 54/60, memsys 53/60.** The difference is one question, well inside the noise. Full context cost $1.96 for 60 questions against $6.45 for memsys.

They fail on different questions, and the split matches section 1:

| Type                      | memsys | Full context |
| ------------------------- | ------ | ------------ |
| multi-session             | 10/10  | 7/10         |
| knowledge-update          | 8/10   | 7/10         |
| single-session-assistant  | 8/10   | 10/10        |
| single-session-preference | 8/10   | 10/10        |
| single-session-user       | 9/10   | 10/10        |
| temporal-reasoning        | 10/10  | 10/10        |

- memsys wins where facts must be gathered or updated across sessions: counting, adding up, the latest value. Distilled fragments are easier to reason over than 50 raw sessions.
- Full context wins on every single-session detail memsys lost at write time: the GR-90 trail, the chord progression, the coupon store, and the user's research field. Each of these was in the transcript and not in memory.

What this means:

- On LongMemEval_S, a model with a 1M-token window does not need memory. Its sessions fit in one prompt. So a score on S says little about whether memsys is worth it. LongMemEval_M (about 500 sessions per question, more than 1M tokens) is the version where full context cannot work.
- The single-session gap is the cost of what the writer drops. Fixing the write side (section 1) should move those questions toward full context without losing the multi-session wins.

### 6. Jev halves what recall returns and costs about 170 ms

Offline replay (`replay.eval.ts`, [replay-medium.md](runs/baseline-1021/replay-medium.md)): the 279 recorded answer-time recalls, run again against each question's saved memory under three plugin setups. No agent and no DeepSeek; Jev bills Workers AI. The `as run` setup reproduced the recorded result exactly for 278 of 279 recalls, so the replay matches what the agent saw.

| Setup | Returned | Via anchors | Empty recalls | Evidence found | Median / p95 added |
| --- | --- | --- | --- | --- | --- |
| as run (idf, Jev off) | 2,115 | 1,518 | 95 | 92 | — |
| idf + Jev (associations only) | 985 | 388 | 95 | 92 | 174 / 291 ms |
| idf + Jev (matches too) | 805 | 352 | 97 | 93 | 172 / 253 ms |

At strictness `medium`, no Jev failures after retries.

- **Noise:** Jev cuts returned fragments by 53 to 62% and associated ones by about 75%. That is the token saving the agent reads.
- **Evidence:** the total barely moves, because recall truncates after plugins: what Jev drops lets lower-ranked fragments into the page, and some of those are evidence.
- **But Jev drops exactly the memories association exists for.** The associations-only setup lost 2 of the 4 evidence fragments that came back only through `via`, both in questions memsys answered correctly: 2c63a862 ("User started working with real estate agent Rachel on February 15", via `#homebuying`, needed to count the days) and a89d7624 (the user's taste in indie rock, via `#music`, for a Denver trip). The matches-too setup kept both in this run; a single replay cannot say whether that is Jev's judgment or chance near the threshold.
- **Empty recalls stay empty.** Jev cannot help open fix 4; it only filters.

**At `low` (threshold 0.1, [replay-low.md](runs/baseline-1021/replay-low.md)), Jev loses nothing.** Same 279 recalls, no Jev failures:

| Setup | Returned | Via anchors | Empty recalls | Evidence found |
| --- | --- | --- | --- | --- |
| as run (Jev off) | 2,115 | 1,518 | 95 | 92 |
| Jev `low`, associations only | 1,682 | 1,085 | 95 | 94 |
| Jev `low`, matches too | 1,512 | 964 | 95 | 92 |

- No needed memory was dropped in either setup, including the 2 that `medium` lost.
- Associations only found 2 more needed memories than Jev off: removing clear misses let lower-ranked evidence into the page.
- Noise cut is smaller: 20 to 29% of returned fragments, against 53 to 62% at `medium`.
- Latency is the same, about 170 ms median, because the cost is the model call, not the level.

So `low` is the safe point found so far: it removes clear misses without touching what association is for. `medium` saves about twice the tokens and puts association-only memories at risk.

Whether `low` holds up with a real agent needs the answer step rerun with Jev on (about $0.15), and the replay repeated to see how stable Jev's verdicts are.

### Reproduce the numbers

```sh
cd eval/longmemeval/runs/baseline-1021
cat */sessions.jsonl | jq -s 'map(.tools[]) | group_by(.name) | map({(.[0].name): length}) | add'
for f in */answer.json; do jq -r '.tools[] | select(.name=="recall") | [(.args.cue | split(" ") | length), (.result | test("\"fragments\":\\[\\]"))] | @tsv' "$f"; done | sort | uniq -c
```
