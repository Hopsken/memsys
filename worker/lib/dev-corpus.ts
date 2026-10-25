import type { Author, LogRecord, PersonaRecord } from "@core";

const WORK: Author = "persona:seedwrk";
const HOME: Author = "persona:seedhme";
const OLD: Author = "persona:seedbt";

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

const memories: { by?: Author; date: string; fragment: string; ref: string }[] =
  [
    {
      date: "2026-09-20",
      fragment:
        "memsys stores each user's fragments in Cloudflare Durable Objects #memsys #cloudflare #durable-objects",
      ref: "seed2aa",
    },
    {
      by: WORK,
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
      by: WORK,
      date: "2026-09-17",
      fragment:
        "Each test has at most 5 expects, per the oxlint rules #preference #must-read #memsys",
      ref: "seed5aa",
    },
    {
      by: "agent:Claude Code",
      date: "2026-09-16",
      fragment:
        "Vite dev server allowedHosts cannot be true, or it returns 403 #vite #lesson",
      ref: "seed6aa",
    },
    {
      by: WORK,
      date: "2026-09-15",
      fragment:
        "DOs get evicted, so the in-memory corpus must rebuild from SQLite #memsys #durable-object #do-eviction",
      ref: "seed7aa",
    },
    {
      by: OLD,
      date: "2026-09-14",
      fragment:
        "Run database migrations with wrangler d1 migrations apply #memsys #d1 #migration",
      ref: "seed8aa",
    },
    {
      by: HOME,
      date: "2026-09-13",
      fragment: "Bird migration season is autumn #birds #migration",
      ref: "seed9aa",
    },
  ];

export const corpus = memories.map(
  ({ by = "user", date, fragment, ref }): LogRecord => ({
    at: `${date}T12:00:00.000Z`,
    by,
    fragment,
    op: "remember",
    ref,
    v: 1,
  })
);

// Covers every kind of author the UI shows. No app or key belongs to the
// personas yet; assign one in Settings → MCP.
export const corpusLog = [...personas, ...corpus]
  .map((record) => JSON.stringify(record))
  .join("\n");
