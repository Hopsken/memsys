import type { LogRecord } from "@contract/memory";

const memories = [
  {
    date: "2026-09-20",
    fragment:
      "memsys stores each user's fragments in Cloudflare Durable Objects #memsys #cloudflare #durable-objects",
    ref: "seed2aa",
  },
  {
    date: "2026-09-19",
    fragment: "D1's primary region is in US West #memsys #cloudflare #d1",
    ref: "seed3aa",
  },
  {
    date: "2026-09-18",
    fragment: "The user prefers bun over pnpm #preference #must-read",
    ref: "seed4aa",
  },
  {
    date: "2026-09-17",
    fragment:
      "Each test has at most 5 expects, per the oxlint rules #preference #must-read #memsys",
    ref: "seed5aa",
  },
  {
    date: "2026-09-16",
    fragment:
      "Vite dev server allowedHosts cannot be true, or it returns 403 #vite #lesson",
    ref: "seed6aa",
  },
  {
    date: "2026-09-15",
    fragment:
      "DOs get evicted, so the in-memory corpus must rebuild from SQLite #memsys #durable-object #do-eviction",
    ref: "seed7aa",
  },
  {
    date: "2026-09-14",
    fragment:
      "Run database migrations with wrangler d1 migrations apply #memsys #d1 #migration",
    ref: "seed8aa",
  },
  {
    date: "2026-09-13",
    fragment: "Bird migration season is autumn #birds #migration",
    ref: "seed9aa",
  },
];

export const corpus = memories.map(({ date, fragment, ref }): LogRecord => ({
  at: `${date}T12:00:00.000Z`,
  by: "user",
  fragment,
  op: "remember",
  ref,
  v: 1,
}));

export const corpusLog = corpus
  .map((record) => JSON.stringify(record))
  .join("\n");
