# RFC 0001: Append-only fragment log

- Status: Proposed
- Created: 2026-09-21
- Revised: 2026-09-27
- Discussion: pull request #12

## Summary

Make a memory's durable state an append-only log of fragment records. `remember` and `revise` append a complete snapshot of the fragment; `forget` appends a record with no text. Replaying each ref's records by `at`, latest wins, yields the current corpus. Every index stays a derived cache, as today.

The log lives where fragments live now: in the memory Durable Object's SQLite, one row per record. Its canonical serialization is NDJSON, which is also the export format. Moving the log to another store is a separate decision the format does not depend on.

The public `Fragment` carries one timestamp, `at`: the time of its latest record. Creation and update times are not stored; the history holds them.

## Motivation

Today `revise` overwrites a row and `forget` deletes it. The memory holds only its present state, which sits badly with two tenets:

- **Faithful.** The system never forgets on its own, yet one mistaken `revise` or `forget`, from the agent or from an injected prompt, destroys the earlier text for good.
- **Inspectable.** A person can read their whole memory, but not how it came to be.

An append-only log keeps everything that was written, lets the user see and undo what an agent changed, and exports as a plain-text file that stays readable without memsys.

## Record format

The canonical serialization is UTF-8 NDJSON, one record per line:

```json
{"v":1,"ref":"7x9c2pa","fragment":"Deploys go through wrangler. #memsys","at":"2026-09-21T08:00:00.000Z"}
{"v":1,"ref":"7x9c2pa","fragment":"Deploys go through `pnpm deploy`, which applies migrations first. #memsys","at":"2026-09-22T10:30:00.000Z"}
{"v":1,"ref":"7x9c2pa","fragment":null,"at":"2026-09-25T09:00:00.000Z"}
```

- Every record has exactly these keys. `v` is the record schema version, starting at `1`. `at` is ISO 8601 UTC with milliseconds.
- A string `fragment` is the complete text at that point: a snapshot, never a patch. `null` means the fragment was forgotten.
- `at` is the order. A ref's records never share an `at`; records of different refs may, because replay never compares them. Export writes lines sorted by `at`.
- An LF follows every record, including the last. Line breaks inside text are JSON-escaped.
- Readers ignore unknown keys and reject an unknown `v`.

Snapshots rather than operations keep every line readable on its own and keep history independent of how the write tools happen to be shaped. Fragments are short, so the extra bytes do not matter.

## Replay

```text
for each record, ordered by at:
  fragment is null  → remove ref from the corpus
  otherwise         → corpus[ref] = { ref, fragment, at }
```

Replay is a pure function with no Cloudflare imports. The Durable Object uses it on load, import uses it to read a file, and any other tool can reuse it.

A ref that has ever appeared in the log is never handed out again by `remember`; otherwise a new fragment would continue a forgotten one's history. Replay also collects the set of every ref seen.

## Storage

The memory Durable Object replaces its `fragments` table with a `records` table:

```ts
export const records = sqliteTable(
  "records",
  {
    at: integer().notNull(),
    fragment: text(), // null: forgotten
    ref: text().notNull(),
  },
  (table) => [primaryKey({ columns: [table.ref, table.at] })]
);
```

- There is no sequence column: `at`, in epoch milliseconds, is the order, and the key `(ref, at)` enforces that a ref's records never tie. `v` is not stored; the table is versioned by migrations, and `v` is added when serializing.
- A write stamps `at` with the current time. Each write is its own call into the Durable Object and lands well after the previous write to the same ref, so times increase without extra rules. If two writes to one ref ever did land in the same millisecond, the key rejects the second instead of leaving replay order ambiguous.
- `remember`, `revise`, and `forget` each insert one row and then update the in-memory corpus, in the same order as today. The check that a fragment did not change while `revise` hooks ran stays as it is.
- Load reads every record ordered by `at` and replays it. The in-memory corpus remains the only projection.

The Durable Object already provides what an append-only log needs: one writer per memory, transactional writes, and no partial records. An append is one `INSERT`.

Cold start now reads every record instead of only the live fragments. A personal memory of 10,000 fragments with five versions each is 50,000 short rows, far inside a SQLite Durable Object's 10 GB. If load time becomes measurable, a table of current fragments written in the same transaction can be added as a droppable cache.

## Public contract

```ts
export interface Fragment {
  ref: string;
  fragment: string;
  at: string;
}
```

A fragment is its latest record, so it exposes that record's `at`, the time its current text was written. `createdAt` and `updatedAt` disappear from the contract: records are immutable and carry a single time, and when a fragment was first or last changed can always be read from its history.

- **Ordering is unchanged.** Recall ties and the fragment list already order by the time of the current text (`updatedAt` today); they now read `at`. The list cursor becomes `at,ref`.
- **MCP output keeps ISO for now.** A more compact form for agents is tracked in #36.
- **This is a breaking change** to `contract/memory.ts`. It ships together with the log migration, not before.

## Forget and purge

- `forget` appends a `null` record. The fragment leaves recall and the fragment list at once; its text stays in the history.
- An agent can no longer erase anything. An agent tricked into forgetting everything costs the user nothing they cannot restore. This extends Invariant 6: destructive power belongs to the user's session, not the agent's credential.
- **Purge** deletes every record of one ref. It is a user action in the web app, not exposed over MCP or API keys, and it ships with the log so the user never loses the ability to remove text they regret storing.
- A SQLite Durable Object keeps 30 days of point-in-time recovery, so purged text becomes unrecoverable only after that window. Copy must not promise immediate erasure.
- Viewing a fragment's history and restoring an earlier version are what this format enables next. The first version of the web app shows neither; they are a separate work item.

## Export and import

- **Export** writes NDJSON in the same record format. By default it holds current fragments only: one record per live ref, its latest. Optionally it holds the whole log, full history included, enough to rebuild the instance. Both are logs, so both import.
- **Import** accepts either export. The current `memsys.fragments` JSON is not accepted; it is replaced, not kept alongside.
- Refs unknown to this instance arrive with their full history and original `at`. A file that repeats an `at` within one ref is rejected.
- Refs this instance already knows follow today's rules: identical current text is skipped, different text is a conflict. A ref forgotten here counts as known with no text, so an old backup cannot silently bring it back.
- A line may be just `{"fragment":"..."}`, so other tools can produce a file without knowing memsys. Each such line becomes its own new fragment with a fresh ref, stamped with the import time; text already in this memory is skipped. A line that has a `ref` must also have an `at`, and a line without a `ref` must have text.

## Migration

One SQL migration in the memory Durable Object:

```sql
INSERT INTO records (ref, fragment, at)
  SELECT id, content, updated_at FROM fragments ORDER BY updated_at, id;
DROP TABLE fragments;
```

It runs in `blockConcurrencyWhile` with the other migrations, so it is atomic and needs no paused writes or dual-write window. Existing `created_at` values are dropped: each fragment's current text was written at `updated_at`, and the log starts there. Point-in-time recovery is the rollback path.

## Alternatives considered

### Move the log to object storage now

The first draft of this RFC stored the log as an NDJSON object on R2 or S3 through OpenDAL. Every hard part of that design exists only because of the move: conditional whole-object rewrites and retries, torn final lines, R2's one write per second per key, `O(log size)` bytes written per append, segment manifests and compaction, a byte-offset index, and an unproven OpenDAL-on-Workers WebAssembly build. None of it is needed to get an append-only log.

Moving storage deserves its own RFC when a concrete need appears, such as self-hosting outside Cloudflare. The format is ready for it: any store that can append lines, or conditionally replace an object, can hold the log, and the same replay reads it. Immutable segments with a small conditional manifest should be the starting point for object storage.

### Keep mutable rows and add a history table

Two tables that must agree are two sources of truth. The log makes the current state a projection, like every other index.

### Operation records

Records such as `replace old with new` are smaller but tie history to the write tools' shape and require replaying every step to read any version.

### TIDs as record IDs

AT Protocol orders records with [TIDs](https://atproto.com/specs/tid): 53 bits of microseconds and a 10-bit random clock ID, encoded as 13 sortable characters, generated monotonically. They give many writers unique, ordered IDs without a shared sequence.

A memory has one writer, and `(ref, at)` already identifies and orders every version. Workers clocks have millisecond resolution, so the microseconds would carry nothing. A TID is also opaque where `at` reads at a glance, and as a `ref` it would cost agents six more characters to read and type.

TIDs become worth it when one memory gains concurrent writers, such as offline clients that sync or merging the full histories of two instances. A TID field can then be added to records without changing how existing ones replay.

## Testing

- Codec round trips: Unicode, line breaks in text, `FRAGMENT_MAX`-length fragments, unknown keys, unknown `v`.
- Replay: remember, several revisions, forget, and a ref that returns after being forgotten.
- Durable Object: each write appends one row; a restart replays to the same corpus; forgotten refs are never reused; purge removes every row of a ref.
- Migration: an existing table yields the same current corpus, with `at` equal to the old `updatedAt`.
- Export: current-only and full history, each importing back to the same current corpus.
- Import: both exports, text-only lines, conflicts, and forgotten refs.
- `pnpm eval` results are unchanged.

## Decision requested

1. Durable state is an append-only log of complete fragment snapshots; `forget` appends `null`.
2. The log lives in the memory Durable Object's SQLite; NDJSON is its canonical serialization and export format.
3. `Fragment` exposes only `at`, the time of its latest record.
4. Agents can only append; purge is a user action.
5. Export defaults to current fragments, with full history as an option.
6. History view and restore in the web app, and moving the log off Durable Objects, are out of scope.
