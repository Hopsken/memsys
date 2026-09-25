// Recall evaluation set: one user's memory and the cues an agent would send.
// Case kinds borrow from LoCoMo (single-hop, multi-hop, adversarial) and
// LongMemEval (knowledge update, abstention), reshaped for short agent cues
// and #anchor association. English only.

export type Kind =
  // The cue appears verbatim in the fragment.
  | "exact"
  // Every cue word appears, but not as one contiguous phrase.
  | "scattered"
  // Cue words appear in another inflection (evicted / eviction).
  | "morphology"
  // The cue carries a word the fragment lacks ("error", "bug").
  | "partial"
  // The answer shares a specific anchor with a direct match.
  | "association"
  // Several fragments answer together, including knowledge updates.
  | "multi"
  // No words in common; out of reach for lexical recall. Measures the ceiling.
  | "semantic"
  // Nothing in memory answers; anything returned is noise.
  | "abstain";

export interface EvalFragment {
  date: string;
  fragment: string;
  id: string;
}

export interface EvalCase {
  context?: string;
  cue: string;
  // Fragments that answer the cue; recall is measured against these.
  hits: string[];
  id: string;
  kind: Kind;
  // Related enough that returning them is not noise.
  ok?: string[];
}

export const fragments: EvalFragment[] = [
  {
    date: "2026-09-20",
    fragment:
      "memsys stores each user's fragments in a SQLite-backed Durable Object #memsys #cloudflare #durable-objects",
    id: "f01",
  },
  {
    date: "2026-09-02",
    fragment:
      "D1's primary region is in US West; reads from Asia add about 150 ms #memsys #cloudflare #d1 #latency",
    id: "f02",
  },
  {
    date: "2026-08-14",
    fragment:
      "Run database migrations with wrangler d1 migrations apply before deploying #memsys #d1 #migration",
    id: "f03",
  },
  {
    date: "2026-09-15",
    fragment:
      "DOs get evicted after idle time, so the in-memory corpus must rebuild from SQLite on start #memsys #durable-objects #do-eviction",
    id: "f04",
  },
  {
    date: "2026-07-21",
    fragment:
      "Vite dev server allowedHosts cannot be true, or tunnel requests get a 403 #vite #lesson",
    id: "f05",
  },
  {
    date: "2026-09-18",
    fragment:
      "Each test has at most 5 expects, per the oxlint rules #preference #testing #memsys",
    id: "f06",
  },
  {
    date: "2026-09-10",
    fragment:
      "memsys authenticates with Cloudflare Access JWTs; never trust the email header #memsys #auth #security",
    id: "f07",
  },
  {
    date: "2026-09-24",
    fragment:
      "The jev plugin times out after 1.5 seconds and fails open #memsys #jev #plugins",
    id: "f08",
  },
  {
    date: "2026-09-24",
    fragment:
      "Workers AI returns Jev's answers wrapped in a gateway envelope, not the bare body from the docs #memsys #jev #workers-ai #lesson",
    id: "f09",
  },
  {
    date: "2026-09-22",
    fragment:
      "Plugin hooks may only reorder or drop recall items, never add them #memsys #plugins #architecture",
    id: "f10",
  },
  {
    date: "2026-09-05",
    fragment:
      "memsys deploys with pnpm deploy, only after pnpm check passes #memsys #deploy",
    id: "f11",
  },
  {
    date: "2026-08-30",
    fragment:
      "vitest-pool-workers pins the compatibility date; bumping it past the pool's runtime breaks tests #memsys #testing #lesson",
    id: "f12",
  },
  {
    date: "2026-09-23",
    fragment:
      "The AI binding is always remote, so local dev bills the Cloudflare account #memsys #workers-ai #cost",
    id: "f13",
  },
  {
    date: "2026-08-02",
    fragment:
      "The user now prefers bun over pnpm for new projects #preference #tooling",
    id: "f14",
  },
  {
    date: "2026-03-10",
    fragment: "The user uses pnpm in every repo #preference #tooling",
    id: "f15",
  },
  {
    date: "2026-05-12",
    fragment:
      "Write commit messages in English, imperative mood, under 72 characters #preference #git",
    id: "f16",
  },
  {
    date: "2026-05-12",
    fragment:
      "The user wants explanations in Chinese but code comments in English #preference #language",
    id: "f17",
  },
  {
    date: "2026-06-03",
    fragment:
      "Prefer small PRs: one concern per pull request #preference #git #review",
    id: "f18",
  },
  {
    date: "2026-06-20",
    fragment:
      "Use oxfmt and oxlint, not prettier or eslint #preference #tooling #lint",
    id: "f19",
  },
  {
    date: "2026-06-20",
    fragment: "Never use default exports in TypeScript #preference #typescript",
    id: "f20",
  },
  {
    date: "2026-07-02",
    fragment:
      "The user dislikes mocks in integration tests; use real SQLite instead #preference #testing",
    id: "f21",
  },
  {
    date: "2026-04-08",
    fragment:
      "ledger is the user's personal finance iOS app, written in SwiftUI #ledger #ios #swiftui",
    id: "f22",
  },
  {
    date: "2026-04-15",
    fragment:
      "ledger syncs through CloudKit; the private database quota counts against the user's iCloud storage #ledger #cloudkit",
    id: "f23",
  },
  {
    date: "2026-05-01",
    fragment:
      "Xcode 26 previews crash when a view uses @Query without a model container #ledger #xcode #swiftdata #lesson",
    id: "f24",
  },
  {
    date: "2026-06-11",
    fragment:
      "App Store review rejected ledger 1.2 for missing a privacy manifest #ledger #app-store #lesson",
    id: "f25",
  },
  {
    date: "2026-04-22",
    fragment:
      "ledger's currency conversion uses rates cached once per day from the ECB feed #ledger #currency",
    id: "f26",
  },
  {
    date: "2026-06-12",
    fragment: "TestFlight builds expire after 90 days #ledger #testflight",
    id: "f27",
  },
  {
    date: "2026-05-03",
    fragment:
      "Migrating ledger from Core Data to SwiftData lost the transaction ordering; add an explicit sortIndex #ledger #swiftdata #migration #lesson",
    id: "f28",
  },
  {
    date: "2026-02-14",
    fragment:
      "The blog is built with Astro and deployed on Cloudflare Pages #blog #astro #cloudflare",
    id: "f29",
  },
  {
    date: "2026-02-14",
    fragment:
      "Blog drafts live in the drafts/ folder and are excluded from the build #blog #writing",
    id: "f30",
  },
  {
    date: "2026-03-01",
    fragment:
      "Astro image optimization fails on AVIF inputs; convert to PNG first #blog #astro #lesson",
    id: "f31",
  },
  {
    date: "2026-03-01",
    fragment:
      "The blog's RSS feed must include full content, not summaries #blog #rss #preference",
    id: "f32",
  },
  {
    date: "2026-01-20",
    fragment:
      "The home server runs Debian 13 with ZFS on two mirrored disks #homelab #zfs",
    id: "f33",
  },
  {
    date: "2026-01-22",
    fragment:
      "Nightly backups go to Backblaze B2 with restic; retention is 30 days #homelab #backup",
    id: "f34",
  },
  {
    date: "2026-02-02",
    fragment:
      "The system SQLite 3.40.1 gives false positives on integrity_check #homelab #sqlite #lesson",
    id: "f35",
  },
  {
    date: "2026-02-05",
    fragment:
      "The Tailscale exit node is the home server; don't route work traffic through it #homelab #tailscale #work",
    id: "f36",
  },
  {
    date: "2026-07-08",
    fragment:
      "The work laptop blocks Docker Desktop; use colima instead #work #docker #tooling",
    id: "f37",
  },
  {
    date: "2026-07-09",
    fragment:
      "The work VPN breaks DNS for *.internal until you restart mDNSResponder #work #vpn #lesson",
    id: "f38",
  },
  {
    date: "2026-07-15",
    fragment:
      "The team's staging database is refreshed from production every Sunday night #work #staging #database",
    id: "f39",
  },
  {
    date: "2026-07-16",
    fragment:
      "On-call rotation is weekly and hands off on Monday at 10:00 #work #oncall",
    id: "f40",
  },
  {
    date: "2026-08-04",
    fragment:
      "Kafka consumer lag alerts fire at 10k messages for the orders topic #work #kafka #alerts",
    id: "f41",
  },
  {
    date: "2026-08-05",
    fragment:
      "The orders service must stay on Java 17 until the payments SDK supports 21 #work #java #orders",
    id: "f42",
  },
  {
    date: "2026-08-06",
    fragment:
      "OrderTimeoutTest fails when the machine is under load; rerun it, don't patch the timeout #work #orders #testing #lesson",
    id: "f43",
  },
  {
    date: "2026-08-10",
    fragment:
      "Terraform state for work lives in an S3 bucket with DynamoDB locking #work #terraform",
    id: "f44",
  },
  {
    date: "2026-03-18",
    fragment:
      "Pandas read_csv silently parses IDs with leading zeros as integers; pass dtype=str #python #pandas #lesson",
    id: "f45",
  },
  {
    date: "2026-03-19",
    fragment:
      "Use uv for Python environments, not pip or poetry #preference #python #tooling",
    id: "f46",
  },
  {
    date: "2026-03-25",
    fragment:
      "The Python 3.13 free-threaded build breaks numpy wheels on the home server #python #homelab #lesson",
    id: "f47",
  },
  {
    date: "2026-01-05",
    fragment:
      "The user's cat is named Miso and needs thyroid medication twice a day #personal #miso",
    id: "f48",
  },
  {
    date: "2026-01-05",
    fragment: "The user is allergic to penicillin #personal #health",
    id: "f49",
  },
  {
    date: "2026-01-06",
    fragment: "The user drinks decaf after 3 pm #personal #preference",
    id: "f50",
  },
  {
    date: "2026-09-13",
    fragment:
      "Bird migration season peaks in October around the local wetland #personal #birds #migration",
    id: "f51",
  },
  {
    date: "2026-08-22",
    fragment:
      "The user's favorite bakery sells cardamom buns on Saturdays #personal #food",
    id: "f52",
  },
  {
    date: "2026-02-28",
    fragment:
      "The user is learning Japanese and practices with Anki every morning #personal #japanese #learning",
    id: "f53",
  },
  {
    date: "2026-08-28",
    fragment:
      "The passport expires in March 2027; renew it before booking the Japan trip #personal #travel #japan",
    id: "f54",
  },
  {
    date: "2026-09-01",
    fragment:
      "The Japan trip is planned for April, with two days in Kyoto #personal #travel #japan",
    id: "f55",
  },
  {
    date: "2026-02-15",
    fragment:
      "Cloudflare Pages preview deployments are public by default; protect them with Access #cloudflare #security #lesson",
    id: "f56",
  },
  {
    date: "2026-09-16",
    fragment:
      "Durable Object alarms fire at least once, so alarm handlers must be idempotent #cloudflare #durable-objects #lesson",
    id: "f57",
  },
  {
    date: "2026-08-19",
    fragment:
      "R2 presigned URLs cannot last longer than 7 days #cloudflare #r2",
    id: "f58",
  },
  {
    date: "2026-06-25",
    fragment:
      "The GitHub API allows 5000 requests per hour with a personal access token #github #api",
    id: "f59",
  },
  {
    date: "2026-09-12",
    fragment:
      "gh pr create needs --head when pushing from a worktree branch #github #git #lesson",
    id: "f60",
  },
  {
    date: "2026-09-11",
    fragment:
      "A shared git stash across worktrees clobbered another session's work; set work aside with WIP commits instead #git #lesson",
    id: "f61",
  },
  {
    date: "2026-09-21",
    fragment:
      "memsys fragments are capped at 1000 graphemes by core #memsys #limits",
    id: "f62",
  },
  {
    date: "2026-09-24",
    fragment:
      "The idf plugin weighs each anchor by ln((N+1)/(df+1)) #memsys #idf #plugins",
    id: "f63",
  },
  {
    date: "2026-09-24",
    fragment:
      "Recall returns 10 fragments by default and at most 40 #memsys #recall #limits",
    id: "f64",
  },
  {
    date: "2026-06-30",
    fragment:
      "The user reviews PRs in the morning and codes in the afternoon #preference #work #schedule",
    id: "f65",
  },
];

export const cases: EvalCase[] = [
  { cue: "allowedHosts", hits: ["f05"], id: "c01", kind: "exact" },
  {
    context: "Preparing the ledger 1.3 App Store submission",
    cue: "privacy manifest",
    hits: ["f25"],
    id: "c02",
    kind: "exact",
  },
  { cue: "integrity_check", hits: ["f35"], id: "c03", kind: "exact" },
  { cue: "Kafka consumer lag", hits: ["f41"], id: "c04", kind: "exact" },
  { cue: "presigned URLs", hits: ["f58"], id: "c05", kind: "exact" },

  {
    context: "Choosing where to put a new Cloudflare database",
    cue: "D1 region",
    hits: ["f02"],
    id: "c06",
    kind: "scattered",
  },
  {
    context: "The dev server returns 403 through a tunnel",
    cue: "vite 403",
    hits: ["f05"],
    id: "c07",
    kind: "scattered",
  },
  {
    context: "Writing unit tests for the recall module",
    cue: "test expects",
    hits: ["f06"],
    id: "c08",
    kind: "scattered",
  },
  { cue: "ledger SwiftUI", hits: ["f22"], id: "c09", kind: "scattered" },
  { cue: "restic retention", hits: ["f34"], id: "c10", kind: "scattered" },
  {
    cue: "staging database Sunday",
    hits: ["f39"],
    id: "c11",
    kind: "scattered",
  },
  {
    context: "Upgrading the orders service JDK",
    cue: "Java payments SDK",
    hits: ["f42"],
    id: "c12",
    kind: "scattered",
  },
  { cue: "Astro AVIF", hits: ["f31"], id: "c13", kind: "scattered" },
  { cue: "Japan passport", hits: ["f54"], id: "c14", kind: "scattered" },

  {
    context: "Debugging lost in-memory state in a Durable Object",
    cue: "evicted Durable Object",
    hits: ["f04"],
    id: "c15",
    kind: "morphology",
  },
  { cue: "eviction", hits: ["f04"], id: "c16", kind: "morphology" },
  {
    context: "Test data vanished from staging",
    cue: "refresh staging",
    hits: ["f39"],
    id: "c17",
    kind: "morphology",
  },
  {
    cue: "migrate to SwiftData",
    hits: ["f28"],
    id: "c18",
    kind: "morphology",
  },
  {
    cue: "expiring TestFlight builds",
    hits: ["f27"],
    id: "c19",
    kind: "morphology",
  },
  { cue: "backup retention", hits: ["f34"], id: "c20", kind: "morphology" },
  {
    context: "Writing a Durable Object alarm handler",
    cue: "idempotent alarm handler",
    hits: ["f57"],
    id: "c21",
    kind: "morphology",
  },

  {
    context: "The dev server returns 403 through a tunnel",
    cue: "vite dev server 403 error",
    hits: ["f05"],
    id: "c22",
    kind: "partial",
  },
  {
    context: "Customer IDs lost their leading zeros after import",
    cue: "pandas leading zeros bug",
    hits: ["f45"],
    id: "c23",
    kind: "partial",
  },
  {
    cue: "colima docker desktop alternative",
    hits: ["f37"],
    id: "c24",
    kind: "partial",
  },
  {
    context: "About to commit a change",
    cue: "commit message style",
    hits: ["f16"],
    id: "c25",
    kind: "partial",
  },
  { cue: "VPN DNS issue", hits: ["f38"], id: "c26", kind: "partial" },
  { cue: "cat's pills", hits: ["f48"], id: "c27", kind: "partial" },

  {
    context: "Booking hotels for the April trip",
    cue: "Kyoto",
    hits: ["f55", "f54"],
    id: "c28",
    kind: "association",
    ok: ["f53"],
  },
  {
    context: "Adding a column to the memsys D1 database",
    cue: "wrangler d1 migrations",
    hits: ["f03"],
    id: "c29",
    kind: "association",
    ok: ["f02"],
  },
  {
    context: "Jev scores come back undefined",
    cue: "gateway envelope",
    hits: ["f09"],
    id: "c30",
    kind: "association",
    ok: ["f08", "f13"],
  },
  {
    context: "OrderTimeoutTest failed in CI again",
    cue: "OrderTimeoutTest",
    hits: ["f43"],
    id: "c31",
    kind: "association",
    ok: ["f42"],
  },
  {
    context: "Scheduling cleanup work in a Durable Object",
    cue: "Durable Object alarms",
    hits: ["f57"],
    id: "c32",
    kind: "association",
    ok: ["f01", "f04"],
  },

  {
    context: "Setting up a new TypeScript repo",
    cue: "pnpm",
    hits: ["f14", "f15"],
    id: "c33",
    kind: "multi",
  },
  {
    cue: "Japan",
    hits: ["f53", "f54", "f55"],
    id: "c34",
    kind: "multi",
  },
  {
    context: "Working on ledger persistence",
    cue: "SwiftData",
    hits: ["f24", "f28"],
    id: "c35",
    kind: "multi",
  },
  {
    context: "Calling a model from the worker",
    cue: "Workers AI",
    hits: ["f09", "f13"],
    id: "c36",
    kind: "multi",
  },
  {
    context: "Designing storage for a new Cloudflare service",
    cue: "Durable Objects",
    hits: ["f01", "f04", "f57"],
    id: "c37",
    kind: "multi",
  },

  {
    context: "Setting up a new TypeScript repo",
    cue: "package manager",
    hits: ["f14"],
    id: "c38",
    kind: "semantic",
    ok: ["f15"],
  },
  {
    context: "The user asked about a prescription",
    cue: "antibiotics",
    hits: ["f49"],
    id: "c39",
    kind: "semantic",
  },
  { cue: "evening coffee", hits: ["f50"], id: "c40", kind: "semantic" },
  {
    context: "Setting up a new TypeScript repo",
    cue: "code formatter",
    hits: ["f19"],
    id: "c41",
    kind: "semantic",
  },

  {
    context: "Writing the memsys landing page",
    cue: "memsys pricing",
    hits: [],
    id: "c42",
    kind: "abstain",
  },
  { cue: "kubernetes ingress", hits: [], id: "c43", kind: "abstain" },
  {
    context: "Planning the next ledger release",
    cue: "ledger Android version",
    hits: [],
    id: "c44",
    kind: "abstain",
  },
  { cue: "birthday gift ideas", hits: [], id: "c45", kind: "abstain" },
  {
    context: "Adding static analysis to a Python repo",
    cue: "Python type checker",
    hits: [],
    id: "c46",
    kind: "abstain",
  },
];
