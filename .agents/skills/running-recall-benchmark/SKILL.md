---
name: running-recall-benchmark
description: "Runs the memsys recall benchmark on LongMemEval (eval/longmemeval): sets up the dev Worker, Pi, and the Hugging Face data, runs write/label/recall, compares runs, and records findings. Use when asked to evaluate, benchmark, or measure memsys recall, compare recall or reader models, write a new corpus, or continue LongMemEval eval work."
---

# Running the recall benchmark

The design is in `docs/rfcs/0003-recall-benchmark.md`; the commands are in `eval/longmemeval/README.md`. Read both before changing the harness. This skill is the working procedure and the pitfalls found so far.

Rules that hold for every session:

- Git holds only the harness. All test data (question sets, corpora, `corpus.json`, `labels.json`, runs) lives on the private Hugging Face dataset `Hopsken/memsys-longmemeval-corpora`. `eval/longmemeval/hub/` is its local copy, ignored by git, filled on demand. Never commit data.
- Run findings are not committed. Keep them wherever the person running the benchmark keeps notes, and ask them for the last kept run before comparing.
- Runs cost real money. Say the expected cost before a run larger than smoke.

## 1. Setup

```sh
git pull
# hf reads HF_TOKEN, a token with read access to the dataset (write access to upload)
which hf || uv tool install 'huggingface_hub[cli]'
which pi || npm i -g @earendil-works/pi-coding-agent
```

The dev Worker needs `.dev.vars`. If it is missing, every route returns 500 with "MCP resource must be an absolute URL":

```sh
printf 'PUBLIC_URL=http://127.0.0.1:5174\nBETTER_AUTH_SECRET=%s\nAUTH_ALLOWED_EMAILS=dev@memsys.test\nEMAIL_FROM=\nRESEND_API_KEY=\n' "$(openssl rand -base64 32)" > .dev.vars
pnpm exec vite dev --config eval/longmemeval/vite.config.ts   # in a long-lived session
sleep 10; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5174/__dev/eval/probe/export   # expect 200
```

Also needed in the environment: `OPENCODE_API_KEY` (Pi models via OpenCode Go), and `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (Jev, the judge). Check with `env | grep -o '^NAME'`; never print values.

Runs take minutes; start `write.ts` and `recall.ts` in a long-lived terminal session, such as a tmux window per run. Do not run them under a supervisor that restarts processes when they exit, or a finished run starts again.

## 2. Pick what to run

| Change | Run | Cost |
| --- | --- | --- |
| Recall engine, ranking, `recall` description | `smoke`, then `dev` against the last kept run on the same corpus | $0.01, ~$0.10 |
| Reader model comparison | `dev` per model, same corpus | ~$0.07–0.13 each |
| Write side: server instructions, `remember`/`revise`/`forget`, write model | New corpus with `write.ts`, then `label.ts`, hand review, then recall | ~$0.07 per question |
| Final check after several kept changes | `dev` with a second reader model, then `holdout` once | ~$0.10 each |

The current dev corpus is `dev-deepseek-v4.1-flash-d7b05cb5`. List corpora and runs with:

```sh
curl -s -H "Authorization: Bearer $HF_TOKEN" https://huggingface.co/api/datasets/Hopsken/memsys-longmemeval-corpora/tree/main | jq -r '.[].path'
curl -s -H "Authorization: Bearer $HF_TOKEN" https://huggingface.co/api/datasets/Hopsken/memsys-longmemeval-corpora/tree/main/runs | jq -r '.[].path'
```

## 3. Run

```sh
# a quick probe first: one question, one repeat, to check model, thinking level, and keys
node eval/longmemeval/recall.ts --corpus <corpus> --run probe --set smoke --only 58bf7951 --repeats 1 --model opencode-go/<model>
rm -rf eval/longmemeval/hub/runs/probe

# the run, in tmux
tmux new-window -n <run> "node eval/longmemeval/recall.ts --corpus <corpus> --run <run> --set dev --model opencode-go/<model> > /tmp/<run>.md 2>/tmp/<run>.err; echo exit \$? >> /tmp/<run>.err"
wc -l eval/longmemeval/hub/runs/<run>/recalls.jsonl     # progress: 180 lines for dev with 3 repeats
```

- Run names: `dev-<n>` for the main reader, `dev-<model>` for another reader, `<set>-<topic>` for an experiment. A new name per configuration; never reuse a run name with different flags, since an interrupted run resumes from `recalls.jsonl`.
- List models with `pi --list-models | grep opencode-go`. Pi moves a thinking level the provider lacks to another one; `pi.ts` then fails the run. `deepseek-v4.1-flash` has `low`, `high`, `max`, no `medium`.
- To compare with an earlier run, download it: `hf download Hopsken/memsys-longmemeval-corpora --repo-type dataset --include "runs/<run>/*" --local-dir eval/longmemeval/hub`. Rerunning `recall.ts` with the same `--corpus` and `--run` on a downloaded run only rebuilds `results.md`, at no model cost (the dev Worker must still be up, since it imports the corpus); this is how to apply a change in `score.ts` to old runs. Delete `results.json` to grade the answers with Jev again.

## 4. Read the results

`results.md` columns, in order of importance:

- **found@k**: evidence complete within k rounds. found@5 was ~100% with DeepSeek only because it retries; found@1 is ~70% for every reader tried. Compare found@1 and found@2 first.
- **read** (and ≈tokens) against **dump**, the corpus size: what the agent paid to read.
- **rounds**: recall calls per conversation, budget 5.
- **stale**: knowledge-update fragments holding a replaced value.
- **answer**: Jev grade, secondary. Answers in 0.3–0.7 are listed for a look.

Write misses and abstention questions are outside the recall denominator. A write miss is a writer problem; do not patch the corpus by hand (the old `patch.ndjson` overlay was removed on purpose).

Compare recall engines with the same reader model and the same corpus. Use a reader that gives up easily (`glm-5.3-flash`, `gpt-6-luna`) next to DeepSeek: it shows empty-recall problems that DeepSeek hides by retrying. Compare `read` as a mean over the 3 repeats; a single repeat varies by 10 or more fragments.

Useful queries on `hub/runs/<run>/results.json` and `recalls.jsonl`:

```sh
jq -r '.[]|select(.writeMiss|not)|select(.id|endswith("_abs")|not)|select(.found|not)|[.id,.repeat,.read,(.rounds|map(.cue)|join(" | "))]|@tsv' results.json   # misses with their cues
jq -s '[.[].tools[]|select(.name=="recall")]|{calls:length, empty:(map(select(.result|test("\"fragments\":\\[\\]")))|length)}' recalls.jsonl   # empty recalls
```

## 5. Writing a corpus

```sh
node eval/longmemeval/write.ts --set dev --subset smoke [--model ...] [--thinking high]   # smoke first, then without --subset
node eval/longmemeval/label.ts --corpus <corpus>
```

Then read `hub/<corpus>/labels-review.md`, the 0.18–0.5 band in particular, and correct `hub/<corpus>/labels.json` by hand. Jev at 0.5 misses some real evidence. Local files are never overwritten by downloads, so hand edits survive. The memsys dev Worker must not change between write sessions of one corpus.

## 6. Keep the results

```sh
hf upload Hopsken/memsys-longmemeval-corpora eval/longmemeval/hub . --repo-type dataset --exclude "**/.pi/**" --exclude ".cache/**"
```

Upload only runs worth keeping; delete probes first. Then write down the finding outside git: date, corpus, reader, the summary table, what changed against the last kept run, and the run names on Hugging Face as evidence.

## Known pitfalls

- A memory space is imported once per corpus and question, keyed by record count. The harness cannot wipe a space; to re-import changed records, stop the dev Worker, delete `.wrangler/state/v3/do` (this also wipes the local dev account's memory), and start it again.
- `results.json` from older runs may carry removed fields (`noise`, `wasted`, `overBudget`); they are ignored.
- A tool call cancelled in the UI may still have run. Check running processes and terminal sessions before starting a run again.
- LongMemEval_S fits in a 1M context, so a full-context reader ties memsys on it. Scores on S say how well recall works, not whether memory is needed.
