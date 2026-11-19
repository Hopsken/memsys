# RFC 0007: Log sequence keys and record timestamps

- Status: Proposed
- Created: 2026-11-19
- Discussion: [Amp thread](https://ampcode.com/threads/T-01a1f16c-857a-7549-8242-f04fb81ae3f5)
- Updates: [RFC 0001](0001-append-only-fragment-log.md), where it orders records by timestamp without a sequence column and exposes a single `at` field, and [RFC 0006](0006-natural-language-memory.md), where it keys the snapshot cutoff on a timestamp

## Summary

The `records` table in the memory core moves from a composite `(ref, at)` primary key to an autoincrement integer primary key `id`, keeps the 7-character `ref` as the memory identifier, and renames `at` to `createdAt`.

Log position now orders versions and bounds the prompt snapshot cutoff. Each write stamps `createdAt` from `Date.now()` without logical clock adjustments. NDJSON exports rename `at` to `createdAt` at `v` 1 and preserve causal order by line position instead of sorting by timestamp.

Replaying a `ref`'s records yields a `Fragment` with `createdAt` from its first non-null record, `updatedAt` from its latest non-null record, and `versionId` set to that latest record's `id`. Internal APIs and the web UI address historical versions by `id` instead of ISO timestamps.

## Why

Today `at` carries five jobs at once: wall-clock write time, per-fragment version order, the global prompt snapshot cutoff, half of the SQLite primary key, and pagination cursors. Three problems follow from that design.

First, `at` misstates what the timestamp means. A bare `at` reads as the time an event in the memory happened rather than when memsys recorded the row. Dropping `createdAt` in RFC 0001 compounded the confusion. `Fragment.at` holds the timestamp of the latest revision, yet `worker/services/memory/prompt.ts` renders every snapshot line as `written <at>`. Fixing a typo months later moves `at` forward and causes relative-date resolution in Tidy to count from the edit date instead of the original write date.

Second, using `at` as a global cursor distorts wall-clock timestamps. Commit `933bd91` promoted `nextAt()` in `core/do.ts` to a whole-log monotonic clock, `Math.max(Date.now(), this.latestAt + 1)`, so `readLog` could partition `<memory_snapshot>` and `<recent_updates>` without relying on implicit SQLite rowids. Because `importLog` advances `latestAt` with no upper bound, importing one record with a future timestamp pushes every later write in that memory space into the future. Meanwhile, plain-text `importLog` stamps every imported line with one `Date.now()`, so `activity` falls back to sorting same-millisecond rows by random `ref` and scrambles file order.

Third, the composite key adds avoidable index writes and brittle API parameters. Without `WITHOUT ROWID`, `PRIMARY KEY (ref, at)` plus `records_at_ref_idx` updates three B-trees on every append. On the API boundary, callers pass millisecond ISO strings to `restore`, URL query parameters, and `TidyDO` staleness checks, where even omitting `.000` fails validation.

## Decisions

### 1. Give sequence, identity, and write time separate fields

Each record in `records` separates three concerns:

- `id` is an `INTEGER PRIMARY KEY AUTOINCREMENT` column. It identifies one log record inside one SQLite Durable Object and defines local append order. It is local to the SQLite instance and never appears in NDJSON exports.
- `ref` remains a 7-character base32 string that links all versions of one logical memory. Internal model loops on `note` and Tidy still pass `ref` to `revise` and `forget`. In a 34-billion keyspace holding a few thousand memories, a mistyped or hallucinated `ref` fails with `not-found` and lets the model self-correct. Sequential integer memory IDs are 100 percent dense, so an off-by-one slip would overwrite or forget an unrelated memory without error. Random `ref` values also allow `importLog` to merge exports across instances without ID collisions.
- `createdAt` is an integer holding epoch milliseconds from `Date.now()` when the row is written. `latestAt` and `+1ms` clock shifts are removed, so concurrent or rapid writes may share `createdAt`.

### 2. Use a clustered autoincrement table with two secondary indexes

`core/db/schema.ts` defines `records` with `id` as the clustered rowid key and two composite indexes:

```ts
export const records = sqliteTable(
  "records",
  {
    createdAt: integer().notNull(),
    fragment: text(),
    id: integer().primaryKey({ autoIncrement: true }),
    op: text().$type<Op>().notNull(),
    ref: text().notNull(),
    source: text().$type<Source>(),
  },
  (table) => [
    index("records_ref_id_idx").on(table.ref, table.id),
    index("records_created_at_id_idx").on(table.createdAt, table.id),
  ]
);
```

`AUTOINCREMENT` is required here. Plain `INTEGER PRIMARY KEY` reuses the highest `id` when the owner purges the most recent memory, which breaks monotonic snapshot cursors, browser caches, and staleness checks. Updating `sqlite_sequence` inside an in-process Durable Object SQLite database costs microseconds per write.

Every read path matches an index:

- `load` and `readLog` scan the clustered `id` B-tree in ascending `id` order, and `LogRead.cursor` holds the highest `id`.
- `history`, `purge`, and the `activity` predecessor query `WHERE ref = ? AND id < ? ORDER BY id DESC LIMIT 1` scan `records_ref_id_idx`. Keying predecessor lookup on `id < row.id` instead of `at < row.at` finds the exact prior text even when two edits share a millisecond.
- `activity` orders rows by `(createdAt DESC, id DESC)` using `records_created_at_id_idx`. Keeping `createdAt` first preserves chronological day grouping in the Activity UI when older backups are imported, while `id DESC` gives same-millisecond writes a deterministic order.

### 3. Order log replay by position and rename NDJSON timestamps to createdAt

An append-only log already carries order in the position of its entries. Removing logical clock increments means log parsing and replay follow position rather than sorting timestamps:

1. **NDJSON field rename.** Log records stay at `v` 1 and replace `at` with `createdAt` as an ISO 8601 UTC millisecond string, matching `PersonaRecord`. Because the export format has not shipped with a backwards-compatibility guarantee, `logRecordSchema` drops `at` directly.
2. **Serialization order.** `serializeLog` writes full-history exports in `records.id ASC` order without re-sorting by timestamp. Current-only exports order active fragments by `versionId ASC` and write each fragment's `updatedAt` into the snapshot record's `createdAt`.
3. **Line-order parsing and replay.** `parseLog` removes the check that rejects two records of the same `ref` with equal timestamps and removes the timestamp sort. `replay` processes records in iteration order without skipping rows whose `createdAt` is less than or equal to an earlier row.
4. **Preserving cross-ref order on import.** `importLog` first determines which `ref` values in the file are accepted, then inserts all rows belonging to accepted `ref` values in their original file order instead of grouping rows by `ref`.

### 4. Derive createdAt, updatedAt, and versionId on Fragment and address versions by id

MCP keeps its two plain-text tools unchanged. Core models and owner-facing HTTP endpoints update as follows:

- `Version` contains `{ id, ref, fragment, op, source, createdAt }`.
- `Fragment` contains `{ ref, fragment, source, createdAt, updatedAt, versionId }`. During `replay`, the first non-null record of a `ref` sets `createdAt`, and each non-null record updates `updatedAt` and `versionId` to its own `createdAt` and `id`. Naming the pointer `versionId` rather than `id` avoids confusion between a record sequence number and the memory's `ref`.
- `POST /api/fragments/:ref/restore` accepts `{ id: number }`, queries `WHERE id = ? AND ref = ?`, and returns `Restored` as `{ version: Version, fragment: ListedFragment | null }`. Separating `version` from `fragment` keeps the newly appended version's `createdAt` distinct from the fragment's original `createdAt`.
- `ForgottenFragment` inherits `versionId` from the last non-null state before `forget`, so restoring from Forgotten memories sends `{ id: item.versionId }`.
- `TidyDO` records `versionId` on proposed changes and skips a proposal at apply time when `current.versionId !== change.versionId`, catching concurrent edits that land in the same millisecond.
- `list` orders active fragments by `(updatedAt DESC, versionId DESC)` with cursor `<updatedAt>,<versionId>`. Activity entries link to history dialogs with `?version=<id>`, and the history timeline keys and highlights rows by `version.id`.

## Not in this RFC

- **Prompt redesign for the memory model and Tidy.** Implementation updates `worker/services/memory/prompt.ts` only to read the renamed timestamp fields. Rethinking how prompts expose record history and timestamps to the model is left to a dedicated RFC.
- **Importing legacy NDJSON files that use `at`.** Pre-change test fixtures and `worker/lib/dev-corpus.ts` update in place.
- **Multi-writer sync across concurrent instances.** A memory space still has one Durable Object writer.

## Alternatives considered

### Use INTEGER PRIMARY KEY without AUTOINCREMENT

Without `AUTOINCREMENT`, deleting the tail record via `purge` causes SQLite to assign the deleted `id` to the next insert. That breaks the invariant that a higher `id` always represents a later write. Saving one `sqlite_sequence` update per write does not justify reusing version identifiers.

### Replace ref with sequential integer memory IDs

Using the first record's `id` as the memory identifier removes `ref`, but exposes a dense integer sequence to internal model tool calls where an off-by-one number mutates a real memory, and causes every memory ID to collide when merging exports between two instances.

### Keep a per-ref hybrid logical clock alongside id

Keeping `Math.max(Date.now(), latestByRef + 1)` would keep `(ref, createdAt)` unique, at the cost of falsifying timestamps whenever rapid writes or future-dated imports touch that `ref`. Once `id` in SQLite and line order in NDJSON carry causality, `createdAt` needs no logical clock rules.

## Migration

One Durable Object SQLite migration rebuilds `records` in `(at ASC, ref ASC)` order, adds both secondary indexes, and clears the stored prompt cursor:

```sql
CREATE TABLE `__new_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ref` text NOT NULL,
	`fragment` text,
	`op` text NOT NULL,
	`source` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_records` (`ref`, `fragment`, `op`, `source`, `createdAt`)
	SELECT `ref`, `fragment`, `op`, `source`, `at`
	FROM `records`
	ORDER BY `at` ASC, `ref` ASC;
--> statement-breakpoint
DROP TABLE `records`;
--> statement-breakpoint
ALTER TABLE `__new_records` RENAME TO `records`;
--> statement-breakpoint
CREATE INDEX `records_ref_id_idx` ON `records` (`ref`, `id`);
--> statement-breakpoint
CREATE INDEX `records_created_at_id_idx` ON `records` (`createdAt`, `id`);
--> statement-breakpoint
DELETE FROM `metadata` WHERE `key` = 'logCursor';
```

Deleting `logCursor` from `metadata` is required because existing instances store a 13-digit millisecond timestamp there. Leaving that number in place after `readLog` switches to small `id` integers would satisfy `id <= after` on every subsequent write, folding new changes into `<memory_snapshot>` and invalidating the prompt prefix cache on every call.
