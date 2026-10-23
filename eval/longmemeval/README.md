# LongMemEval for memsys

The recall benchmark of [RFC 0003](../../docs/rfcs/0003-recall-benchmark.md) on [LongMemEval_S](https://github.com/xiaowu0162/LongMemEval) (cleaned release). A corpus is written once per writer version and kept; recall runs read it with two read-only tools and are scored on what they bring back. The RFC has the design; this file has the commands.

## Setup

```sh
pnpm exec vite dev --config eval/longmemeval/vite.config.ts   # dev Worker on :5174, no Cloudflare login
npm i -g @earendil-works/pi-coding-agent                        # Pi
uv tool install 'huggingface_hub[cli]'                          # hf, with HF_TOKEN set
```

Pi's model is `--model`; the default `opencode-go/deepseek-v4.1-flash` needs `OPENCODE_API_KEY`. Jev, the judge, needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. `write.ts` downloads the dataset to `data/` on first use (277 MB).

## Commands

```sh
node eval/longmemeval/write.ts --set dev [--subset smoke] [--model ...] [--thinking high]
node eval/longmemeval/label.ts --corpus <name>
node eval/longmemeval/recall.ts --corpus <name> --run <run> [--set smoke] [--model ...] [--repeats 3] [--rounds 5]
```

- **write** replays each session of a set in a fresh Pi conversation with every memsys tool, then saves `hub/<name>/<question>/memory.ndjson` and `hub/<name>/corpus.json` with each record moved to its session's day. The name is the set, the write model, and a hash of the writer version (model, thinking, server instructions, write tool descriptions, `WRITER` in `write.ts`). About $0.07 per question. A question is skipped when its `memory.ndjson` exists, so an interrupted write continues.
- **label** asks Jev which fragments written from each evidence session carry the answer, and writes `labels.json` (question → session → refs) and `labels-review.md`, every candidate with its score. Correct `labels.json` by hand; a rerun keeps hand edits. An empty list is a write miss and leaves the recall denominator.
- **recall** runs Pi on each question with `list_tags` and `recall` only, `--rounds` recall calls at most (`budget.ts`), `--repeats` times. It writes `hub/runs/<run>/results.md`: found, read next to the dump size, rounds, stale fragments for knowledge-update, and the answer graded by Jev as a secondary metric. An interrupted run continues; delete `results.json` to grade again.

Sets: `smoke` (2 per type) is the head of `dev` (10 per type); `holdout` (10 per type) shares nothing with `dev`; `full` is all 500.

For a recall change: `smoke` to check nothing broke, then `dev` against the last kept run on the same corpus (found does not drop, read or rounds drop). After several kept changes, `dev` with a second recall model, then `holdout` once. A write-side change (server instructions, `remember`/`revise`/`forget`, the write model) makes a new corpus.

## Storage

Git keeps only the harness. All test data lives in the private Hugging Face dataset [`Hopsken/memsys-longmemeval-corpora`](https://huggingface.co/datasets/Hopsken/memsys-longmemeval-corpora), and `hub/` (ignored by git) is a local copy of its root:

- `sets/<set>.json`: the questions, answers, and evidence turns of a set.
- `<corpus>/`: `corpus.json` (writer version and cost), `labels.json`, `labels-review.md`, and per question `memory.ndjson` and `sessions.jsonl`.
- `runs/<run>/`: `run.json`, `recalls.jsonl`, `results.json`, `results.md`.

`label.ts` and `recall.ts` download a set, a corpus's `corpus.json` and `labels.json`, and its `memory.ndjson` files the first time they need them, and never overwrite a local file. After writing a corpus, correcting labels, or keeping a run, upload it:

```sh
hf upload Hopsken/memsys-longmemeval-corpora eval/longmemeval/hub . --repo-type dataset --exclude "**/.pi/**"
hf download Hopsken/memsys-longmemeval-corpora --repo-type dataset --include "runs/<run>/*" --local-dir eval/longmemeval/hub
```

The dev routes behind this (`/__dev/eval/:space/mcp`, `/export`, `/import` in `worker/dev`) take no credentials and exist only in development builds.
