# LongMemEval through Pi

Measures memsys as a whole system: the MCP server instructions, the tool descriptions, what an agent chooses to remember, and what recall returns. A real agent ([Pi](https://pi.dev)) with memsys as its only tools does both the writing and the answering, so a change to any of these shows up in the score.

Data is [LongMemEval_S](https://github.com/xiaowu0162/LongMemEval) (cleaned release). Each of its 500 questions is a different simulated user with a history of about 50 sessions, so each question gets its own memory space. Merged, their facts would contradict each other.

## Run

```sh
pnpm exec vite dev --config eval/longmemeval/vite.config.ts   # dev Worker on :5174, no Cloudflare login
node eval/longmemeval/run.ts --run <name> [--per-type 10] [--only id,id] [--concurrency 6]
```

Needs `pi` (`npm i -g @earendil-works/pi-coding-agent`) and `DEEPSEEK_API_KEY`. `MODEL` (default `deepseek/deepseek-flash`) and `THINKING` (default `medium`) select the model for Pi and the judge. The dataset downloads to `data/` on first run (277 MB). `--per-type n` takes the same n questions of each type on every machine.

Output goes to `runs/<name>/`, one directory per question. Runs are ignored by Git unless listed in `.gitignore` to keep; `runs/baseline-1021/` is kept as the first baseline (60 questions, 53 correct), with every session log, memory, answer, and verdict. Pi's per-conversation config (`runs/*/.pi/`) is never kept. Every step is skipped when its output exists, so rerunning a run name continues it. Delete `verdict.json` files to regrade, or `answer.json` files to ask again.

Write what each run teaches in [LEARNINGS.md](LEARNINGS.md) before starting the next one.

## Steps

1. **Write.** For each session, oldest first, Pi gets the transcript in a new conversation and stores what it judges worth keeping (`sessions.jsonl`). The space is `eval:<run>-<question>-w`.
2. **Redate.** The written log is exported, each record moved to its session's date with its order kept, and imported into `eval:<run>-<question>-q` (`memory.ndjson`), so `at` reads as when the user said it. Temporal questions depend on this.
3. **Ask.** Pi gets the question in a new conversation, with today's date, and recalls as it sees fit (`answer.json`).
4. **Judge.** DeepSeek grades the answer with LongMemEval's own prompts, and labels which current memories the answer needs (`verdict.json`).

`results.md` sorts every wrong answer into the first stage that failed: nothing needed was written, no recall, recall returned none of the needed memories, it returned some, or it returned all and the answer is still wrong.

The harness puts the full MCP server instructions in the system prompt and declares the memsys tools directly. Pi by default shows only the first line of server instructions and hides MCP tools behind its codemode, which would test Pi's discovery instead of memsys's text.

## Limits

- The judge is the same model as the agent. LongMemEval's published scores use GPT-4o, so numbers are not comparable with theirs.
- `deepseek-flash` is an alias; the fingerprint in each verdict records which version answered.
- Evidence labels come from a model reading the whole memory. Treat a stage count as a lead to read the per-question rows, not as a measurement.
- Sessions are personal-assistant chat, not coding work.

The dev routes behind this (`/__dev/eval/:space/mcp`, `/export`, `/import` in `worker/dev`) take no credentials and exist only in development builds.
