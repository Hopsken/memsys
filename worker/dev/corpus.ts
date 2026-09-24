// Seed data for local development; imported only by worker/dev.

export interface SeedFragment {
  fragment: string;
  // Calendar day; createdAt and updatedAt are both noon UTC that day.
  date: string;
}

// The shared test corpus from RFC 3–7 in English, in order f1–f8. Its anchors are chosen
// on purpose: #memsys is a hub, durable-object(s) only meet after stemming,
// "migration" is ambiguous across f7/f8, and f5 shares nothing.
export const corpus: SeedFragment[] = [
  {
    date: "2026-09-20",
    fragment:
      "memsys stores each user's fragments in Cloudflare Durable Objects #memsys #cloudflare #durable-objects",
  },
  {
    date: "2026-09-19",
    fragment: "D1's primary region is in US West #memsys #cloudflare #d1",
  },
  {
    date: "2026-09-18",
    fragment: "The user prefers bun over pnpm #preference #must-read",
  },
  {
    date: "2026-09-17",
    fragment:
      "Each test has at most 5 expects, per the oxlint rules #preference #must-read #memsys",
  },
  {
    date: "2026-09-16",
    fragment:
      "Vite dev server allowedHosts cannot be true, or it returns 403 #vite #lesson",
  },
  {
    date: "2026-09-15",
    fragment:
      "DOs get evicted, so the in-memory corpus must rebuild from SQLite #memsys #durable-object #do-eviction",
  },
  {
    date: "2026-09-14",
    fragment:
      "Run database migrations with wrangler d1 migrations apply #memsys #d1 #migration",
  },
  {
    date: "2026-09-13",
    fragment: "Bird migration season is autumn #birds #migration",
  },
];
