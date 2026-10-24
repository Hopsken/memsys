# RFC 0004: A memory core, and apps built on it

- Status: Proposed
- Created: 2026-10-23
- Revised: 2026-10-24
- Discussion: [Amp thread](https://ampcode.com/threads/T-01a16953-7f79-7339-b52f-f803d00bd08c)
- Supersedes: decisions 2 and 3 of [RFC 0002](0002-recall-contract.md), as far as they describe stages as plugins and a host that runs them

## Summary

memsys splits into two parts:

- **The memory core** (`core/`) is a storage engine with indexes. It owns the fragment log, its meaning, and the indexes derived from it. It stores, looks up, and scores fragments against query terms, as an index does; it never decides what is relevant. Its interface is meant to hold for years.
- **Apps** build on the core. The Worker (`worker/`) is the first: HTTP, MCP, sign-in, the owner's settings, and every recall algorithm. The web UI reaches the core only through the Worker.

There are no plugins. A recall algorithm is Worker code that calls the core's index queries; several can exist side by side. The recall contract from RFC 0002 does not change: the agent sends `{ cue, context? }` and gets `{ fragments, truncated }`.

## Why

The plugin system tried to keep the core stable while recall changed. It put the line in the wrong place: matching and spreading were "core" stages, ranking and judging were plugins, and a host guarded each stage from the others. The result was a core that changed with every recall experiment and a host that defended against code it already trusted.

The line that holds is the one storage engines draw. Lucene stores documents and keeps an inverted index; Elasticsearch decides how to score. SQLite keeps tables and indexes; the app decides what to ask. memsys does the same: the core answers "which fragments match these terms, and how well", the app decides what is relevant.

Hono-style middleware does not fit either. Recall steps need differently shaped inputs (matches, associations, a ranked list), and an onion passes one untyped context in registration order, which RFC 0002 already rejected.

## Decisions

### 1. What belongs in the core

Something is in the core if it needs at least one of these:

1. **Atomicity.** It must run inside the Durable Object's single thread: appending a record, the per-ref clock, never reusing a ref.
2. **State that grows with the corpus and is kept up to date incrementally.** Indexes. Shipping the whole corpus to the app on every recall would cost more than the split saves.
3. **The meaning of the data.** What a fragment, a record, `forget`, and the 1000-character ceiling are.

Everything else is an app's: which hits to keep, phrase-first ordering, how far to spread, anchor ranking, model judgment, the result size and `truncated`, the owner's length limits, and settings.

### 2. The core's interface

```ts
// core/index.ts: the whole surface an app may use.
interface MemoryCore {
  // Writes. Core validation only: not empty, at most FRAGMENT_MAX.
  remember(
    input: { fragment: string },
    by: Author
  ): Result<Fragment, InvalidInput>;
  revise(
    input: { ref: string; fragment: string },
    by: Author
  ): Result<Fragment, InvalidInput | NotFound>;
  forget(input: { ref: string }, by: Author): Result<{ ref: string }, NotFound>;
  restore(input: { ref: string; at: number }): Result<Restored, NotFound>;
  purge(input: { ref: string }): Result<{ ref: string }, NotFound>;
  importLog(input: {
    content: string;
    format: "ndjson" | "text";
  }): Result<ImportResult, InvalidInput>;
  exportLog(input: { history: boolean }): string;

  // Reads in log order.
  get(refs: string[]): Fragment[];
  list(input: { cursor?: string; tag?: string[] }): FragmentPage;
  history(input: { ref: string }): Result<History, NotFound>;
  activity(input: { cursor?: string }): ActivityPage;
  forgotten(): ForgottenList;

  // Index queries.
  search(
    terms: string[]
  ): { fragment: Fragment; score: number; matched: string[] }[];
  associated(keys: string[]): { fragment: Fragment; via: string[] }[];
  anchors(): { anchor: string; fragments: number }[];

  // The whole corpus, for prototypes and the eval.
  snapshot(): Fragment[];

  // State an app keeps beside the memory; the core never reads it.
  readMetadata(key: string): JsonObject | null;
  patchMetadata(key: string, patch: JsonObject): JsonObject;
}
```

- `search` returns every fragment that contains at least one of the terms, best first. `score` says how well it matches, higher is better; how it is computed is the core's choice (BM25 today). `matched` lists the terms it contains. Changing the scoring changes no shape.
- `associated` returns every fragment with an anchor whose association key is in `keys`, newest first, with the matching anchors as `via`. `anchors` counts the fragments carrying each anchor; tag listing and anchor ranking both use it.
- New capabilities arrive as new methods or new optional fields. A new kind of index, such as embeddings, is a new query method: prototype it in the app over `snapshot()`, and move it into the core once the eval shows it helps.

### 3. Errors are values

```ts
// contract/result.ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
export type Code = "invalid" | "not-found" | "unavailable";
export interface Failure<C extends Code = Code, R extends string = string> {
  code: C; // canonical class; alone decides the HTTP status
  reason: R; // the exact cause, for machines: "too-long", "version-not-found", ...
  message: string; // written where the failure is made, for whoever reads it
  issues?: Issue[];
  retry?: boolean; // for "unavailable": whether retrying shortly can help
}
```

- A result and its failure are plain objects, so they cross the Durable Object RPC unchanged.
- Failures follow the canonical-code model of gRPC and Google's [AIP-193](https://google.aip.dev/193): a few fixed `code`s, each with one HTTP status, and a free `reason`. A new failure picks a code; nothing that maps codes changes for it.
- An expected failure is an error value; only a bug throws. The core never returns `null`, an ad-hoc `{ error: string }`, or an HTTP response.
- The Worker adds its own reasons (`too-long`, `invalid-settings`, `relevance-unavailable`). Routes call `unwrap(result)`, which throws a failure for the app's error handler; `worker/routes/problem.ts` maps codes to statuses: `invalid` 422, `not-found` 404, `unavailable` 503 with `Retry-After`, or 502 when retrying cannot help. MCP tools send `message`. Response bodies keep their shape (`{ error, issues?, retry? }`).
- There is no library and no combinators until use cases need them.

### 4. The analyzer is part of the index

Tokenizing, stemming, stopwords, and how anchors split into association keys (`lib/analyzer.ts`) define what the indexes contain. The core indexes fragments with it when they are written; apps run cues through the same functions before they query. Changing the analyzer means rebuilding the indexes, which the core does on start, since every index is a rebuildable cache.

### 5. The core has no outside I/O

The core needs no bindings: no Workers AI, no D1, no email. Its Durable Object runs migrations on its own SQLite, replays the log, builds its indexes, and answers. The indexes (`FragmentIndex` in `core/search.ts`) are plain code over the current fragments; the Durable Object (`core/do.ts`) feeds them from SQLite, and tests and the eval feed them from memory (`inMemory`). Apps and the eval therefore test against the real core without workerd.

### 6. Apps keep untyped metadata in the core, which never reads it

The owner's settings (length limits, relevance filter level) are the Worker's: their schema, defaults, and checks live there. The Worker keeps them as the `settings` metadata document, `readMetadata("settings")` and `patchMetadata("settings", patch)`, so they live with the memory space they belong to and need no D1 table.

- `patchMetadata` applies a JSON Merge Patch ([RFC 7396](https://www.rfc-editor.org/rfc/rfc7396)) inside the Durable Object: given fields replace the stored ones, a field set to `null` is removed, other fields stay. It returns the merged document. The merge is atomic, so saves need no read first and no conflict detection; the last save of a field wins.
- Metadata is untyped JSON by key; the core gives keys no meaning. One key is one row. The core reads every row into memory on start, so reading metadata costs no storage read per call.
- A missing field means its default, so "reset to defaults" removes fields, and a field that no longer parses falls back to its default on its own.
- The core does not read metadata. A rule the core itself must apply, such as one that has to run atomically with a write, would be a typed part of the core, not an entry here.

The owner's length limits are checked by the Worker before it calls `remember` or `revise`. They need no state, so nothing is lost by checking them outside the core. Import calls the core directly and is not checked, as before.

### 7. The Worker is routes, services, and clients

The Worker follows the layout common to Hono and other Node backends:

```
worker/
  index.ts      the app: security middleware, mounted routes, the error boundary
  routes/       one Hono app per resource, the MCP server and its tools, and
                problem.ts, where a failure's code becomes an HTTP status
  services/     the rules: MemoryService (every call to a memory space, with
                the length limits), recall policy, the owner's settings
  clients/      outside services: Jev on Workers AI, Resend
  middlewares/  sign-in: a browser session for /api, a bearer token for /mcp
  lib/          Better Auth setup, openMemory (the only use of the MEMORY
                binding), the dev corpus
  db/           the D1 schema Better Auth uses
  errors.ts     the Worker's error values: too long, invalid settings, relevance unavailable
  types.ts      what the sign-in middlewares hand to routes in c.var
```

- Dependencies point one way: routes call services; services call the core and use `contract/`, `lib/`, and `worker/errors.ts`; clients, middlewares, and `worker/lib/` never call routes or services, except `lib/memory.ts`, which opens the MemoryService. Services import no HTTP or platform API, so tests run them in Node against the in-memory core. Lint enforces it, as it does the client's layers.
- Every call to a memory space goes through `MemoryService`, one per request in `c.var.memory`. It applies the Worker's rules, such as the owner's length limits on agent writes, so no route or tool can skip them. Only `lib/memory.ts` touches the `MEMORY` binding; lint rejects any other use.
- It follows Hono's guidance: no controller classes, handlers written on the route, input checked with zod schemas.
- Bindings are read from the global `env` of `cloudflare:workers`, not passed through constructors or `c.var`. Only values that change per request travel in `c.var`: the caller's MemoryService, which knows who writes, and their scopes. Better Auth is the exception: it keeps one instance per env object, so it reads `c.env`, and its tests swap env objects to check setup and query isolation.
- Services are classes over the core's interface: `MemoryService`, `RecallService`, and `SettingsService`. None subclasses the Durable Object, so the Worker's rules stay out of the core. `MemoryService` creates the other two; `RecallService` takes its relevance judge in its constructor, so tests and the eval pass a fake or Jev with their own Workers AI.
- Jev splits along the same line: "judge what you keep, or fail the recall", the budget, and the thresholds are recall rules in `services/recall.ts`; calling Workers AI, retrying, and classifying its errors is `clients/jev.ts`.

### 8. The core is a module now and a package later

`core/` sits beside `contract/` and `lib/` with its own Drizzle config, schema, and migrations, separate from the Worker's D1 setup. It may not import `worker/` or `client/`, and apps import it only through `core/index.ts`. When a second app needs it, it moves to `packages/core` with a `package.json`; the code does not change.

## Migration

- `worker/memory-do/`, the index-building half of `worker/recall/match.ts` and `spread.ts`, and the log code in `worker/log.ts` and `worker/memory.ts` move into `core/`, BM25 scoring with them. Which hits to keep, ranking, Jev, and the cut stay in the Worker.
- A Durable Object migration adds the metadata table, turns `plugin_config` into the Worker's `settings`, and drops `plugin_config`. Jev on becomes the filter at its strictness (`medium` for rows from before strictness existed); Jev off becomes `off`. The size-limit numbers carry over; a disabled size-limit becomes limits at the core ceiling of 1000.
- The core no longer matches a cue as a phrase on its own: a cue of only stopwords, such as "the", returns nothing. Phrase matches still come first, since the Worker checks each hit's text.
- Saving settings no longer fails with 409 when another window saved first.
- HTTP and MCP do not change for callers, except that a relevance filter error no longer starts with `jev:`. `/api/plugins` becomes `GET` and `PATCH /api/settings`; **Settings → Plugins** redirects to **Settings → Features**. Owners who had turned off tag ranking or `list_tags` get them back.

## Consequences

- A recall makes two calls to the core: `search`, then `associated` with the seeds' anchors. Worker-to-Durable-Object calls are fast, so this is expected to cost little; it is measured before the change lands.
- `search` returns every fragment containing any term, so a very common cue word returns a lot. That is fine at the size of one person's memory; a bound can be added to the query later without changing its meaning.
- Recall gets faster as the corpus grows: today every recall recomputes term and anchor statistics over the whole corpus; the core keeps them up to date on write.
- BM25 lives in the core. Another term-scoring method is a core change, but not an interface change.
- The core and the Worker are still one script and deploy together. "Stable" means the core's interface, and that recall changes never touch storage or need a Durable Object migration.
- A third-party or runtime-loaded extension would still need a new design. Nothing asks for one.

## Testing

- Core: the engine on an in-memory store and on the Durable Object's SQLite gives the same answers; indexes match a rebuild from the log after every kind of write; `patchMetadata` follows RFC 7396.
- Worker: recall on the eval dataset returns the same fragments and `truncated` as before the split, for every relevance filter level, with a deterministic fake judge; the only expected difference is a cue of only stopwords.
- Migration: every saved plugin state becomes the same settings as before.
- The existing HTTP and MCP end-to-end tests pass unchanged.
