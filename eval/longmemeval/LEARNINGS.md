# What each run taught us

Runs cost real money, so every finding is written down here, newest first, with the evidence to check it against. Numbers come from the run's files in `runs/<name>/`; the commands that produce them are under each run.

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

### Reproduce the numbers

```sh
cd eval/longmemeval/runs/baseline-1021
cat */sessions.jsonl | jq -s 'map(.tools[]) | group_by(.name) | map({(.[0].name): length}) | add'
for f in */answer.json; do jq -r '.tools[] | select(.name=="recall") | [(.args.cue | split(" ") | length), (.result | test("\"fragments\":\\[\\]"))] | @tsv' "$f"; done | sort | uniq -c
```
