# RFC 0001: Portable append-only fragment log

- Status: Proposed
- Created: 2026-09-21
- Target: post-0.1 storage architecture
- Discussion: pull request

## Summary

Replace the assumption that a memory space is stored in a SQLite table with a small `FragmentLog` abstraction backed by a logical append-only NDJSON stream. OpenDAL is the proposed portable storage adapter beneath that abstraction.

Each active log record contains the complete fragment state for one revision. A revision therefore remains understandable without replaying a patch language. Deletion is represented by a tombstone. Replaying records in file order materializes the current corpus; anchors, associations, and search structures remain disposable projections derived from that corpus.

The initial object-storage implementation may keep one physical `fragments.ndjson` object and update it with conditional writes. Native append and immutable segmented logs are storage strategies that can be selected from backend capabilities without changing the record format.

## Motivation

The current implementation stores each user's memory in a SQLite-backed Durable Object and loads the `fragments` table into memory. This is simple and gives writes transactional semantics, but it binds persistence to Cloudflare Durable Objects.

A portable fragment log would provide:

- the same durable format on R2, S3, MinIO, and a local filesystem;
- a human-readable export that remains useful without memsys;
- reconstruction of the current corpus and every derived index from one canonical stream;
- the evolution of a memory, including revisions and logical deletions;
- efficient cold loading for the expected small personal corpus;
- optional byte-range reads once a corpus grows beyond the in-memory model.

OpenDAL fits the persistence boundary because it normalizes storage operations and reports backend capabilities. It does not become the query engine. Recall, anchor expansion, ranking, and indexing remain memsys domain behavior.

## Goals

- Define a stable, versioned, human-readable log format.
- Preserve every committed fragment revision in append order.
- Keep active fragment records self-contained.
- Rebuild the current corpus, anchor index, and search projection from canonical data.
- Allow storage backends with different append and conditional-write capabilities.
- Retain the existing `remember`, `recall`, `revise`, and `forget` API semantics at the application boundary, subject to the deletion semantics described below.
- Keep storage-provider details outside the recall engine.

## Non-goals

- Implement a general-purpose database or query language.
- Persist anchors, associations, fuzzy-search indexes, or graph edges as canonical state.
- Require every backend to support native append.
- Make OpenDAL layers interpret fragments or perform hashtag recall.
- Replace the current SQLite backend in this RFC pull request.
- Optimize for corpora that cannot reasonably fit in a Worker isolate.

## Terminology

- **Fragment state record**: a complete active snapshot of one fragment at one revision.
- **Tombstone**: a record that makes a fragment absent from the current corpus while retaining its preceding history.
- **Logical log**: the ordered sequence of records seen by memsys.
- **Physical layout**: one object, several immutable segments, or a local file used to store the logical log.
- **Projection**: current corpus, anchor index, lexical index, or byte-offset index rebuilt from the log.

## Proposed architecture

```text
remember / revise / forget
           |
           v
      FragmentLog
           |
           v
   OpenDAL Operator
           |
    R2 / S3 / FS / MinIO

FragmentLog replay
           |
           +--> current fragments
           +--> anchor index
           +--> lexical search data
           +--> byte-offset index
```

The domain-facing interface stays deliberately small:

```ts
interface FragmentLog {
  load(): AsyncIterable<FragmentLogRecord>;
  append(record: FragmentLogRecord): Promise<void>;
  compact(options: CompactOptions): Promise<void>;
  purge(ref: string): Promise<void>;
}
```

`append` means appending to the logical log. An adapter may implement it with a native append, a conditional whole-object replacement, or a new immutable segment.

## Canonical record format

The canonical serialization is UTF-8 NDJSON:

- one JSON object per physical line;
- LF (`0x0A`) terminates every committed record, including the final record;
- embedded line breaks in fragment text are JSON-escaped;
- byte offsets are measured against the serialized UTF-8 bytes;
- unknown top-level fields are ignored by readers of the same major format version;
- `format` versions the record schema, beginning at `1`.

### Active fragment

Creation writes revision 1:

```json
{"format":1,"state":"active","ref":"7x9c2pa","revision":1,"fragment":"OpenDAL can provide portable storage. #memsys #opendal","createdAt":"2026-09-21T08:00:00.000Z","updatedAt":"2026-09-21T08:00:00.000Z"}
```

A revision appends another complete state record:

```json
{"format":1,"state":"active","ref":"7x9c2pa","revision":2,"fragment":"OpenDAL is the portable persistence adapter. #memsys #opendal","createdAt":"2026-09-21T08:00:00.000Z","updatedAt":"2026-09-21T08:05:00.000Z"}
```

An active record MUST contain:

- `format`: integer record-format version;
- `state`: the literal `"active"`;
- `ref`: the stable fragment reference;
- `revision`: a per-ref integer beginning at 1 and increasing by 1;
- `fragment`: the complete fragment text at this revision;
- `createdAt`: the original creation time, unchanged by later revisions;
- `updatedAt`: the time this revision became current.

The record stores the updated fragment, rather than an edit operation such as `replace old_string with new_string`. MCP edit inputs are request semantics. Persisted history is a sequence of complete states.

### Deleted fragment

Deletion appends a tombstone:

```json
{"format":1,"state":"deleted","ref":"7x9c2pa","revision":3,"createdAt":"2026-09-21T08:00:00.000Z","deletedAt":"2026-09-21T08:10:00.000Z"}
```

A tombstone MUST contain `format`, `state`, `ref`, `revision`, `createdAt`, and `deletedAt`. It MUST omit `fragment`. This keeps the final record concise while the preceding active records preserve the fragment's history.

`forget` therefore becomes a logical deletion. The historical text remains in the log until retention or hard-purge policy removes it. API documentation must disclose this behavior before this storage model becomes the default.

### Why state records instead of operation records

An operation-oriented log could store commands such as `put`, `replace`, and `delete`. That representation couples durable data to mutation APIs and requires replay to understand every historical edit instruction.

Complete state records provide these properties:

- every active line is independently readable;
- replay only needs last-record-wins materialization plus revision validation;
- future API changes do not change historical interpretation;
- corrupted or missing earlier active revisions do not prevent inspection of a later complete state;
- migrations can transform records without executing an edit language.

The `state` discriminator expresses whether the complete materialized state is active or deleted. It is part of the data model rather than an application command.

## Replay and validation

A reader processes records in physical order and maintains `Map<ref, state>`.

For each ref:

1. The first record MUST have `revision: 1` and `state: "active"`.
2. Each following record MUST increment `revision` by exactly one.
3. An active record replaces the current materialized fragment.
4. A tombstone removes the ref from the current corpus.
5. A later active record after a tombstone is invalid in format 1. Restoring a forgotten memory creates a new ref.

Timestamps provide user-visible history and do not determine ordering. Physical log order and `revision` determine ordering.

Malformed interior records are corruption and stop replay. A final unterminated line may be treated as an interrupted append and ignored, then repaired before the next write. Backends that replace complete objects atomically should never expose a partial final line.

After replay, memsys derives:

```ts
Map<FragmentRef, Fragment>
Map<AssociationKey, Set<FragmentRef>>
Map<FragmentRef, { generation: string; offset: number; length: number }>
```

The byte-offset index is an optimization. It can always be discarded and rebuilt. Offsets refer to a named immutable generation so compaction cannot silently redirect a range read to different bytes.

## Recall and association

Warm recall continues to operate on the materialized in-memory corpus:

1. Normalize the cue and find lexical matches.
2. Extract anchors from recalled fragments.
3. Find other active fragments with matching association keys.
4. Rank, bound, and deduplicate results.

Hashtag association belongs in memsys. An OpenDAL `Layer` is appropriate for cross-cutting storage behavior such as metrics, retry, encryption, compression, or cache. Parsing fragment content and expanding recall would couple domain behavior to storage verbs and is outside the layer boundary.

For the expected corpus size, cold start should read and replay the full logical log. Range reads become useful when loading a selected revision by a known byte offset or when a future snapshot/index avoids full replay.

## Physical storage strategies

The format defines one logical log and permits several physical strategies.

### Strategy A: one object with conditional replacement

Store `fragments.ndjson` as one object. To append:

1. Read the current object and its version or ETag.
2. Add one serialized line.
3. Write the complete replacement with an `if-match` condition.
4. Retry from step 1 after a conflict.

This strategy works for a small corpus and keeps the exported representation literally one file. Write bandwidth and latency grow with log size. A single-writer coordinator still reduces conflicts.

### Strategy B: native append

Use native append only when the OpenDAL operator reports `write_can_append` and the backend has passed memsys conformance tests for atomicity, visibility, and concurrent writers.

The application must not infer append support from a backend name. Capability detection is authoritative.

### Strategy C: immutable segments

Store records in immutable NDJSON segments and maintain a small head manifest:

```text
memory/
  HEAD.json
  log/00000001.ndjson
  log/00000002.ndjson
  ...
```

This remains one logical log while avoiding repeated whole-object rewrites. The manifest update must be conditional, and unreferenced segments can be collected after a grace period. This is the preferred growth path for object storage once Strategy A becomes measurably expensive.

## Concurrency and durability

Each memory space requires serialized commits or optimistic concurrency.

The current Durable Object already provides a single coordination point. A portable deployment may instead use conditional writes supported by the backend. An adapter that has neither serialization nor conditional writes MUST reject writes because last-writer-wins replacement can lose committed records.

An append succeeds only after the new logical head is durable. The in-memory corpus is updated after that point. A failed append leaves the in-memory state unchanged.

Retries must be idempotent. A writer should retain the intended `{ref, revision}` across retries and verify whether that revision is already present before committing again.

## Compaction, history, and deletion

Append-only history grows with every revision. Compaction is policy-driven:

- **History-preserving rotation** seals the current generation and starts a new generation from a snapshot while retaining the sealed log as an archive.
- **History-pruning compaction** writes only the latest active record for each ref and discards superseded revisions after a configured retention period.
- **Hard purge** rewrites every retained generation that contains a ref, then removes the replaced generations after the backend's consistency and retention requirements are satisfied.

The default proposed policy is history-preserving rotation. A production design must define storage lifecycle, user-visible export behavior, backup interaction, and a hard-purge path before claiming physical erasure.

Compaction uses a new generation and a conditional head switch. Readers either observe the old complete generation set or the new complete generation set. They never observe an in-place partially compacted log.

## OpenDAL integration boundary

Memsys should depend on its own `FragmentLog` contract. `OpenDALFragmentLog` is one implementation.

Required effective capabilities:

- read;
- write;
- stat or equivalent object-version discovery;
- either conditional write or an external single-writer guarantee.

Optional capabilities:

- native append;
- byte-range read;
- list;
- copy or compose for efficient compaction.

OpenDAL's WebAssembly support is still tracked upstream, although its S3 service has a wasm32 read test. The current TypeScript Worker must therefore pass a deployment spike before OpenDAL becomes a committed runtime dependency. The spike must demonstrate Worker-compatible initialization, S3-compatible R2 read/write, range read, conditional write behavior, bundle size, CPU time, and credential handling.

The log format and `FragmentLog` contract remain useful if the Cloudflare implementation initially uses the native R2 binding and another runtime uses OpenDAL. Runtime portability and data-format portability can land independently.

## Migration from SQLite

Existing SQLite rows contain only current state, so migration cannot reconstruct earlier revisions.

For each row, migration writes one active record with `revision: 1`, preserving `ref`, `fragment`, `createdAt`, and `updatedAt`. The migration then:

1. Replays the generated log.
2. Compares all materialized fragments with the SQLite source.
3. Builds and verifies recall projections.
4. Switches the memory space to the new backend.
5. Retains SQLite for a rollback window.

The cutover requires paused writes or a dual-write protocol with a defined commit authority. A paused per-memory-space migration is preferred for the initial implementation.

## Failure handling

- Unknown format versions stop replay with a clear compatibility error.
- Revision gaps, duplicate revisions with different bytes, and active records after a tombstone are corruption.
- Derived indexes are deleted and rebuilt after any generation change.
- Conditional-write conflicts reload the logical head before retrying.
- Orphaned immutable segments remain unreachable and are garbage-collected later.
- A corrupted canonical log is never silently replaced by a projection.

## Security and privacy

The log contains the full historical text of revised and forgotten memories. Backend encryption, access control, backups, and lifecycle rules must protect that history.

Logical `forget` removes a fragment from recall immediately. Hard purge is a distinct administrative storage operation. Product copy and API documentation must describe the distinction.

Encryption can be supplied beneath `FragmentLog`, including through an OpenDAL layer, as long as range-read and compaction behavior are defined for the encrypted representation.

## Testing requirements

The implementation must include:

- round-trip tests for Unicode, escaped newlines, and the 280-grapheme limit;
- replay tests across create, multiple revisions, and deletion;
- revision-gap, duplicate, malformed-line, and unknown-version tests;
- crash tests around every durable-write boundary;
- concurrent-writer tests for conditional replacement and manifests;
- migration equivalence tests against SQLite;
- conformance tests shared by local filesystem, R2/S3, and any other supported OpenDAL service;
- recall tests proving projections contain only the latest active states;
- compaction and hard-purge tests across generations.

## Rollout plan

1. Introduce `FragmentLog` and record codecs behind tests.
2. Implement a local filesystem adapter for format and replay development.
3. Run the OpenDAL-on-Workers spike.
4. Implement one-object conditional replacement for a non-production memory space.
5. Add SQLite export and equivalence verification.
6. Observe corpus size, cold replay time, write amplification, and failure behavior.
7. Select native append or immutable segments only from measured need and verified capabilities.
8. Make the portable backend opt-in before considering a default change.

## Alternatives considered

### Keep SQLite-backed Durable Objects only

This retains strong local transactions and the smallest Cloudflare-specific implementation. It does not provide a portable storage backend or a directly inspectable history file.

### Store one object per fragment

This makes individual reads simple, but recall and export require listing and many object reads or separate persistent indexes. Revision history also needs another convention.

### Persist edit operations

Patch records can be smaller. They make historical interpretation depend on mutation semantics and all preceding revisions. Complete state records suit short fragments and favor durability, readability, and migration simplicity.

### Persist only the latest snapshot

This minimizes replay and storage. It removes the evolution path that motivates the log and turns each revision into a whole-file state replacement without durable history.

### Store a JSON array

A JSON array is familiar but cannot accept a standalone record append while remaining valid JSON. NDJSON preserves streaming, line-oriented inspection, and byte-offset indexing.

## Open questions

1. What retention period, if any, should apply to sealed history generations?
2. Should user-facing `forget` promise logical deletion only, or trigger hard purge synchronously?
3. Is one-object conditional replacement sufficient for the measured corpus and write rate?
4. Can the current OpenDAL WASM path meet Cloudflare Worker compatibility, bundle-size, and CPU constraints?
5. Should exports include full history by default or only the materialized current corpus?

## Decision requested

Approve the following architectural direction for prototyping:

1. Canonical persistence is a versioned, append-only NDJSON logical log.
2. Every create and revise record stores the complete updated fragment state.
3. Delete records are tombstones; history retention and hard purge are explicit policies.
4. Recall and hashtag association stay in memsys and operate on derived projections.
5. `FragmentLog` shields the domain from physical layout and provider differences.
6. OpenDAL is the preferred portable adapter, gated by a Cloudflare Worker compatibility spike.

## References

- [OpenDAL capability model](https://opendal.apache.org/docs/rust/opendal/struct.Capability.html)
- [OpenDAL wasm32 support tracking](https://github.com/apache/opendal/issues/3803)
- [Cloudflare R2 Workers API: ranged reads and conditional operations](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
