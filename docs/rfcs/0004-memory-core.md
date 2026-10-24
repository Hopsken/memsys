# RFC 0004: A memory core, and apps built on it

- Status: Proposed
- Created: 2026-10-23
- Revised: 2026-10-24
- Discussion: [Amp thread](https://ampcode.com/threads/T-01a16953-7f79-7339-b52f-f803d00bd08c)
- Supersedes: decisions 2 and 3 of [RFC 0002](0002-recall-contract.md), as far as they describe stages as plugins and a host that runs them

## Summary

memsys splits into two parts:

- **The memory core** is a storage engine with indexes. It owns the fragment log, its meaning, and the indexes derived from it. It stores, looks up, and scores fragments against query terms, as an index does; it never decides what is relevant. Its interface is meant to hold for years.
- **Apps** build on the core. The Worker is the first: HTTP, MCP, sign-in, the owner's settings, and every recall algorithm. The web UI reaches the core only through the Worker.

There are no plugins. A recall algorithm is Worker code that calls the core's index queries; several can exist side by side. The recall contract from RFC 0002 does not change.

## Why

The plugin system tried to keep the core stable while recall changed. It put the line in the wrong place: matching and spreading were "core" stages, ranking and judging were plugins, and a host guarded each stage from the others. The result was a core that changed with every recall experiment and a host that defended against code it already trusted.

The line that holds is the one storage engines draw. Lucene stores documents and keeps an inverted index; Elasticsearch decides how to score. SQLite keeps tables and indexes; the app decides what to ask. memsys does the same: the core answers "which fragments match these terms, and how well", the app decides what is relevant.

Hono-style middleware does not fit either. Recall steps need differently shaped inputs (matches, associations, a ranked list), and an onion passes one untyped context in registration order, which RFC 0002 already rejected.

## Decisions

### 1. What belongs in the core

Something is in the core if it needs at least one of these:

1. **Atomicity.** It must run inside the Durable Object's single thread: appending a record, the per-ref clock, never reusing a ref.
2. **State that grows with the corpus and is kept up to date incrementally.** Indexes. Shipping the whole corpus to the app on every recall would cost more than the split saves.
3. **The meaning of the data.** What a fragment, a record, `forget`, and the core's length ceiling are.

Everything else is an app's: which hits to keep, phrase-first ordering, how far to spread, anchor ranking, model judgment, the result size and `truncated`, the owner's length limits, and settings.

### 2. The core's interface

The interface has four groups:

- **Writes**: remember, revise, forget, restore, purge, import, export. Each runs core validation only.
- **Reads** in log order: by ref, a page of the corpus, a fragment's history, the activity log, what was forgotten.
- **Index queries**: which fragments contain any of these terms, with a score and the terms each contains; which fragments carry an anchor with one of these association keys; how many fragments carry each anchor; and the whole corpus, for prototypes and the eval.
- **Metadata**: state an app keeps beside the memory (decision 6).

How a query scores is the core's choice (BM25 today); a new scoring method changes no shape. New capabilities arrive as new methods or new optional fields. A new kind of index, such as embeddings, is a new query method: prototype it in the app over the whole corpus, and move it into the core once the eval shows it helps.

**Apps see the interface as asynchronous.** They reach the core over Durable Object RPC, so every call returns a promise. A test double implements the same asynchronous interface; it does not widen the interface to fit itself.

**The core's types come in two kinds.**

- The **model** is what the data is: a log record, a fragment, a version, and their parts. It is defined as schemas with types inferred from them, because the core parses it at its edges: inputs that arrive over RPC, and log files that arrive on import.
- The **transport** is what each method takes and returns: pages, history, hits. It is types built from the model. Nothing parses a result, so a result has no schema.

### 3. Errors are values

A result is either a value or a failure. A failure has a canonical `code` (`invalid`, `not-found`, `unavailable`), a free `reason` for machines, a `message` written where the failure is made, and optionally the issues and whether retrying can help.

- A result and its failure are plain objects, so they cross the Durable Object RPC unchanged.
- Failures follow the canonical-code model of gRPC and Google's [AIP-193](https://google.aip.dev/193): a few fixed codes, each with one HTTP status, and a free reason. A new failure picks a code; nothing that maps codes changes for it. The mapping lives in one place in the Worker.
- An expected failure is an error value; only a bug throws. The core never returns `null`, an ad-hoc `{ error: string }`, or an HTTP response.
- The result type is generic and belongs to neither side. The failures the core makes are part of its transport; the Worker adds its own reasons.
- There is no library and no combinators until use cases need them.

### 4. The analyzer is part of the index

Tokenizing, stemming, stopwords, and how anchors split into association keys define what the indexes contain. The core indexes fragments with the analyzer when they are written; apps run cues through the same functions before they query. Changing the analyzer means rebuilding the indexes, which the core does on start, since every index is a rebuildable cache.

### 5. The core has no outside I/O

The core needs no bindings: no Workers AI, no D1, no email. Its Durable Object runs migrations on its own SQLite, replays the log, builds its indexes, and answers. The indexes are plain code over the current fragments: the Durable Object feeds them from SQLite, and tests and the eval feed them from memory. Apps and the eval therefore test against the real core without workerd.

### 6. Apps keep untyped metadata in the core, which never reads it

The owner's settings are the Worker's: their schema, defaults, and checks live there. The Worker keeps them as a metadata document in the memory space they belong to, so they need no D1 table.

- Metadata is an untyped object by key; the core gives keys no meaning. The app parses what it reads back.
- A save applies a JSON Merge Patch ([RFC 7396](https://www.rfc-editor.org/rfc/rfc7396)) inside the Durable Object and returns the merged document. The merge is atomic, so saves need no read first and no conflict detection; the last save of a field wins.
- A missing field means its default, so "reset to defaults" removes fields, and a field that no longer parses falls back to its default on its own.
- The core does not read metadata. A rule the core itself must apply, such as one that has to run atomically with a write, would be a typed part of the core, not an entry here.

The owner's length limits are checked by the Worker before it writes. They need no state, so nothing is lost by checking them outside the core. Import is a user migrating memory and is not checked.

### 7. The Worker is routes, services, and clients

The Worker follows the layout common to Hono and other Node backends, with Hono's guidance: no controller classes, handlers written on the route, input checked with schemas.

- Dependencies point one way: routes call services; services hold the rules, call the core, and import no HTTP or platform API, so tests run them in Node against the in-memory core. Lint enforces it, as it does the client's layers.
- Every call to a memory space goes through one service per request, which applies the Worker's rules, such as the owner's length limits on agent writes, so no route or tool can skip them. One module holds the Durable Object binding and puts services together with their clients; a middleware opens the memory space after sign-in has said whose it is.
- Bindings come from the platform's global environment. Only values that change per request travel with the request: who is calling and what they may do. Routes pass the caller to each write, as the core's interface does, so the memory service is about a memory space, not about a caller.
- No service subclasses the Durable Object, so the Worker's rules stay out of the core. Outside services, such as the relevance model, are passed to services, so tests and the eval can pass a fake.
- Recall policy is functions, not a service: it has no state of its own, only the memory space, the cue, and the relevance judge. The judge's type is declared where recall uses it, and the client that implements it matches it by shape.
- **The Worker owns its HTTP API.** The types of what the API takes and returns come from the routes, and the web UI infers them from the Worker; it does not import hand-written copies, and it never imports the core. The types of the Worker's own values, such as recall results and settings, belong to the Worker.

### 8. The core is a module now and a package later

The core has its own schema and migrations, separate from the Worker's D1 setup. It may not import the Worker or the web UI, and apps import it only through its entry point. There is no shared contract module: each type belongs to the module that owns its meaning, so the core depends only on generic code and packages. When a second app needs it, it moves to its own package; the code does not change.

## Migration

- The Durable Object, the index-building half of match and spread, and the log code move into the core, BM25 scoring with them. Which hits to keep, ranking, the relevance filter, and the cut stay in the Worker.
- A Durable Object migration adds the metadata table, turns the saved plugin state into the Worker's settings, and drops it. The relevance filter on becomes the filter at its strictness (`medium` for rows from before strictness existed); off stays off. The size-limit numbers carry over; a disabled size limit becomes limits at the core ceiling.
- The core no longer matches a cue as a phrase on its own: a cue of only stopwords, such as "the", returns nothing. Phrase matches still come first, since the Worker checks each hit's text.
- The shared contract module goes away: each type moves to its owner, and the web UI infers the API's types from the Worker.
- The Durable Object has no development-only methods. The development corpus is imported like any other log, so seeding adds to a memory instead of replacing it.
- Saving settings no longer fails with 409 when another window saved first.
- HTTP and MCP do not change for callers, except that a relevance filter error no longer starts with `jev:`. `/api/plugins` becomes `GET` and `PATCH /api/settings`; **Settings → Plugins** redirects to **Settings → Features**. Owners who had turned off tag ranking or `list_tags` get them back.

## Consequences

- A recall makes two calls to the core: the term query, then the anchor query with the seeds' anchors. Worker-to-Durable-Object calls are fast, so this is expected to cost little; it is measured before the change lands.
- The term query returns every fragment containing any term, so a very common cue word returns a lot. That is fine at the size of one person's memory; a bound can be added later without changing its meaning.
- Recall gets faster as the corpus grows: the core keeps term and anchor statistics up to date on write instead of recomputing them on every recall.
- BM25 lives in the core. Another term-scoring method is a core change, but not an interface change.
- The core and the Worker are still one script and deploy together. "Stable" means the core's interface, and that recall changes never touch storage or need a Durable Object migration.
- A change to the core's types changes the HTTP API's types too, and the web UI fails to compile instead of failing at run time.
- A third-party or runtime-loaded extension would still need a new design. Nothing asks for one.

## Testing

- Core: the engine on an in-memory store and on the Durable Object's SQLite gives the same answers; indexes match a rebuild from the log after every kind of write; metadata saves follow RFC 7396.
- Worker: recall on the eval dataset returns the same fragments and `truncated` as before the split, for every relevance filter level, with a deterministic fake judge; the only expected difference is a cue of only stopwords.
- Migration: every saved plugin state becomes the same settings as before.
- The existing HTTP and MCP end-to-end tests pass unchanged.
