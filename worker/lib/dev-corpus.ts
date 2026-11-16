import type { LogRecord, PersonaRecord, Source } from "@core";

const WORK: Source = "persona:seedwrk";
const HOME: Source = "persona:seedhme";
const OLD: Source = "persona:seedbt";

const personas: PersonaRecord[] = [
  {
    createdAt: "2026-09-01T12:00:00.000Z",
    name: "Work assistant",
    persona: "seedwrk",
    v: 1,
  },
  {
    createdAt: "2026-09-01T12:00:00.000Z",
    name: "Home Muse",
    persona: "seedhme",
    v: 1,
  },
  {
    archivedAt: "2026-09-19T12:00:00.000Z",
    createdAt: "2026-09-01T12:00:00.000Z",
    name: "Old bot",
    persona: "seedbt",
    v: 1,
  },
];

const memories: {
  date: string;
  fragment: string;
  from?: Source;
  ref: string;
}[] = [
  {
    date: "2026-09-20",
    fragment:
      "memsys stores each user's fragments in Cloudflare Durable Objects #memsys #cloudflare #durable-objects",
    ref: "seed2aa",
  },
  {
    date: "2026-09-19",
    fragment: "D1's primary region is in US West #memsys #cloudflare #d1",
    from: WORK,
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
    from: WORK,
    ref: "seed5aa",
  },
  {
    date: "2026-09-16",
    fragment:
      "Vite dev server allowedHosts cannot be true, or it returns 403 #vite #lesson",
    from: "agent:Claude Code",
    ref: "seed6aa",
  },
  {
    date: "2026-09-15",
    fragment:
      "DOs get evicted, so the in-memory corpus must rebuild from SQLite #memsys #durable-object #do-eviction",
    from: WORK,
    ref: "seed7aa",
  },
  {
    date: "2026-09-14",
    fragment:
      "Run database migrations with wrangler d1 migrations apply #memsys #d1 #migration",
    from: OLD,
    ref: "seed8aa",
  },
  {
    date: "2026-09-13",
    fragment: "Bird migration season is autumn #birds #migration",
    from: HOME,
    ref: "seed9aa",
  },
];

export const corpus = memories.map(
  ({ date, fragment, from = "user", ref }): LogRecord => ({
    at: `${date}T12:00:00.000Z`,
    fragment,
    from,
    op: "remember",
    ref,
    v: 2,
  })
);

// Covers every kind of source the UI shows. No app or key belongs to the
// personas yet; assign one in Settings → MCP.
export const corpusLog = [...personas, ...corpus]
  .map((record) => JSON.stringify(record))
  .join("\n");
