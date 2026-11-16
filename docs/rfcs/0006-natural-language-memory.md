# RFC 0006: A natural-language memory system

- Status: Accepted
- Created: 2026-11-16
- Supersedes: [RFC 0002](0002-recall-contract.md)
- Updates: [RFC 0004](0004-memory-core.md), where it places term and anchor search in the core

## Summary

memsys shifts to a natural-language interface and pulls memory curation, retrieval, and storage mechanics inside the system itself, so one shared memory stays clean across all of a person's agents.

Over MCP, outside agents use two plain-text tools: `recall` to ask for relevant context, and `note` to hand off conversation context worth keeping. Outside agents no longer learn memsys's memory philosophy, fragment identifiers, tags, character limits, or revision rules.

Internally, memsys runs a reasoning model as a subagent over the append-only fragment log, holding the entire memory space in its cached prompt prefix. On `recall`, the subagent reasons over the memory space and replies in prose. On `note`, it runs a tool loop over the core's `remember`, `revise`, and `forget` operations to decide what to add, update, or remove.

The append-only fragment log remains the single source of truth. In the web UI, the owner still reads, filters, edits, restores, imports, and exports individual fragments, and audits the subagent's changes in Activity.

## Why

memsys serves one person across multiple personal agents, and two findings from that setup drive this change.

First, different personal agents vary widely in how well they maintain shared memory, and weak writes hurt every other agent. Some clients truncate server instructions, misguess tool schemas, or dump raw session logs. Others copy facts that already live in repositories or append new fragments instead of revising outdated ones. When memsys leaves curation rules and tool discipline to outside agents, one noisy or careless agent pollutes the store that every other agent reads.

Second, lexical search misses situational recall. Term matching and tag spreading fail whenever a task shares no words with a stored fragment, and a post-match relevance filter cannot recover candidates that matching never found.

Meanwhile, one person's curated memories fit inside a million-token context window, and prefix caching keeps repeated reads over a shared prefix cheap. Absorbing curation and retrieval into an internal reasoning model gives every connected agent consistent memory quality behind a minimal natural-language interface.

## Decisions

### 1. MCP exposes `recall` and `note`

MCP exposes two tools, gated by existing connection scopes:

- `recall` requires read scope, takes task and conversation context as plain text, and returns a prose answer without mutating memory.
- `note` requires write scope, takes conversation context as plain text, updates memory when warranted, and returns a short plain-text summary.

Both tools run synchronously in the initial version to keep the system simple. Moving `note` to asynchronous background execution remains open once synchronous usage is proven.

### 2. The subagent encapsulates storage and curates through internal tools

Outside agents never see fragment identifiers, `#anchor` conventions, or storage validation rules.

On `recall`, the subagent reasons over the memory space and answers from stored memories rather than general world knowledge. On `note`, the subagent receives internal `remember`, `revise`, and `forget` tools backed by the core and runs them under the caller's authenticated source. It decides whether incoming context warrants a change and how to apply it, for example ignoring transient noise or revising an outdated preference in place instead of adding a duplicate.

Exact reply phrasing on `recall`, curation guidelines on `note`, and safety bounds stay open to iteration in the subagent's prompt and runtime rather than fixed in this RFC.

### 3. Model choice and subagent runtime

Selecting a model for the subagent comes down to two requirements:

1. **Smart enough to reason over context**, acting like an attentive, knowledgeable reader who gives the right answer and exercises sound judgment once the relevant history is in front of them.
2. **Cheap enough for everyday personal use**, especially on repeated reads over a cached memory prefix.

`DeepSeek-V4.1-Flash-1017` is the initial model because it meets both requirements, pairing strong reasoning and tool use with a million-token context window and low-cost persistent prefix caching.

The subagent runs on `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, and `@earendil-works/pi-schema` so the tool loop, schema validation, and provider protocols do not depend on a single vendor API, making future model switches straightforward.

### 4. Prompt layout for prefix caching and attention

The prompt layout below targets `DeepSeek-V4.1-Flash-1017`, which combines causal prefill, sparse global attention, a high-precision local window at the end of the prompt, and exact-prefix KV caching. Switching to a model with different attention or caching behavior may require tuning this layout:

1. **Unified model settings and tool definitions.** Changing the model, the thinking level, or the declared tool list invalidates the prefix cache from the start of the prompt. `recall` and `note` therefore use the same model, the same thinking level, and the same internal write tool definitions, with tool calling disabled on `recall` and enabled on `note`.
2. **Front rules, frozen base snapshot, then chronological update log.** Rendering one flat list of active fragments would mutate the middle of the prompt whenever an older fragment is revised or forgotten, invalidating the cached prefix after that position. Instead, the system prompt places core rules and the owner's custom instructions at the front, followed by a frozen snapshot of active fragments up to a cutoff position (a rowid watermark), followed by a chronological log of `remember`, `revise`, and `forget` records after that cutoff. The first read fixes the cutoff at the current end of the log. New writes append only to the update log, keeping the snapshot prefix intact while placing recent changes near the end of the context. When the update log grows large, when the owner permanently purges a record, or when the owner imports a log, the cutoff advances (or resets) to fold updates into a new snapshot.
3. **Caller input before tail instructions.** The user message gives the current timestamp and caller input first, then places the specific execution instructions for `recall` or `note` at the very end, inside the local high-attention window right before generation starts.

### 5. Core indexes, owner settings, and web UI

- **Core.** The core keeps the append-only fragment log, personas, metadata, version history, restore, purge, import, and export. It drops lexical and anchor-association search indexes, and provides snapshot-plus-delta reads for prompt assembly.
- **Settings.** Custom owner instructions steer the subagent directly instead of relying on outside callers to obey MCP instructions, and owner fragment-length limits continue to bound the fragments that the subagent writes. Relevance-filter strictness is removed because the subagent now owns retrieval.
- **Web UI.** Fragment browsing, tag and source filtering, Activity auditing, version restore, and import or export stay unchanged, while the recall preview queries the subagent directly.

## Migration

- MCP replaces the five fragment and tag tools with `recall` and `note`, and updates server instructions. The companion skill is removed because the subagent now owns curation.
- The subagent replaces the lexical-and-anchor recall pipeline and the external relevance filter.
- Settings drop relevance-filter strictness while preserving custom instructions and owner fragment-length limits.
- One data migration: the `records.by` column is renamed to `records.source`. It renames the column in place and keeps every row's value, so existing memory spaces need no re-import. The core, the HTTP API, and NDJSON call the field `source`; MCP passes the caller's source on writes and returns no source field.
- NDJSON records keep `v` 1 and name the field `source` instead of `by`. The format has not shipped, so the rename starts no new version and needs no compatibility layer: a file exported before it would import its records without provenance.
