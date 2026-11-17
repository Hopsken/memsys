## Purpose

This document answers one question: **where does a given piece of behavior live?** It describes the layers of memsys and the rules that keep them apart. It does not describe individual features, limits, or wire formats; those live in the code.

A change that only moves a number or adds a setting should not need an edit here. If it does, this document has leaked detail.

## Glossary

- **memory** — one person's durable record: every fragment they kept and every change to it.
- **fragment** — one short, atomic, self-contained piece of text; the unit of memory.
- **source** — where a version of a fragment came from: the person, or one of their agents.
- **snapshot** — the frozen list of current fragments a model reads at the start of its prompt.
- **update** — a log record written after the snapshot cutoff, rendered in order after it.
- **memory model** — the model call that reads memory on `recall` and curates it on `note`.
- **owner** — the person whose memory this is, signed into the web UI.

## Shape

One person has one memory. Their agents share it through two MCP tools: `recall` asks a question and gets prose; `note` hands over conversation context and gets a receipt. The owner reads and edits the same memory in the web UI.

The durable record is an append-only log. `note`, the web UI, and import add records; nothing rewrites an older one. What the owner reads, what the memory model reads, and what export writes all derive from that log.

## Layers

```
┌──────────────────────────────────────────────────────────┐
│ Interfaces — MCP tools, the owner's web API, the UI      │
├──────────────────────────────────────────────────────────┤
│ Memory model — one model reading and curating memory     │
├──────────────────────────────────────────────────────────┤
│ Memory service — owner settings, length limits, prompt   │
├──────────────────────────────────────────────────────────┤
│ Core — the log, replay, versions, metadata, import/export│
├──────────────────────────────────────────────────────────┤
│ Durable object — SQLite: the only truth                  │
└──────────────────────────────────────────────────────────┘
```

Each layer may call the one below it. The core knows nothing about models, settings, HTTP, or the UI. The memory model reaches the log only through the memory service, and the memory service reaches it only through the core.

### The placement test

> **Is this about how a model reads or changes memory, or about what the memory can prove it holds?**

Rules that shape a model's reading or curation belong with the memory model. Rules about what is stored, when a version exists, and how it is replayed belong with the core. Anything the owner decides for themselves belongs in settings.

## The log

- A fragment is text, a ref, a source, and the time it was written.
- `revise` appends a new version; `forget` appends a record with no text. The current corpus is the replay of the log.
- Only the owner deletes records, by purging a fragment in the web UI. Purging also discards the snapshot cutoff, because the log no longer has the same shape.
- Import adds records without rewriting existing ones; it discards the snapshot cutoff too. Export writes the log verbatim.
- Personas name the owner's agents. A record's source is `user`, a persona, or the agent name at the time it wrote.

## Reading memory

`recall` takes what the caller is working on and answers in prose. It never writes.

The memory model does not search. It reads a prompt that holds the memory in two parts:

1. The owner's instructions and memsys's rules.
2. A frozen snapshot of current fragments up to a cutoff, then every log record after that cutoff, in order.

The first read sets the cutoff at the end of the log. The snapshot must not be rebuilt while that cutoff holds: it is the cached prefix the model pays for once and reuses. New writes append to the update list, far from the start of the prompt. When the update list grows past its bound, or after a purge or import, the cutoff advances: the next read folds every update into a new snapshot. Between folds, the prefix is byte-stable for the same owner instructions and tool set.

The caller's words and the current time come after the snapshot, and the instruction for this call (`recall` or `note`) comes last, where the model attends most closely.

`recall` and `note` share the model, the thinking level, the system prompt, and the declared write tools. Only tool choice differs: `recall` disables tools, `note` allows them. One prompt shape keeps the cached prefix valid across both calls.

## Writing memory

Two paths write:

- **The memory model on `note`** decides whether the context holds anything worth keeping and uses the core's write operations. It works under the caller's source, and the owner's length limits apply to what it stores. Its tool loop is bounded by turns, writes, and deletes. A write that has already happened stays if a later turn fails, and the error says what changed.
- **The owner in the web UI** writes, revises, restores, imports, and purges directly. These are human actions, not agent tooling, and the REST endpoints behind them are the owner's, not part of MCP.

The receipt for `note` is computed from what actually happened, not written by the model, so it cannot overstate or invent a change. It reports counts only; it never repeats memory content.

## Settings

- The owner's instructions are prepended to the memory model's system prompt, after memsys's rules and before the snapshot. Changing them changes the cached prefix, by design.
- Length limits bound every fragment the memory model stores, with a warning between the two numbers and a refusal above the higher one. The core also keeps an absolute ceiling no setting can raise.
- A missing setting means its default; a stored value that no longer parses falls back on its own.

## Permissions

`memory:read` grants `recall`; `memory:write` grants `note`. A connection needs at least one of them to enter MCP. Tools are gated by actual scopes, so a write-only connection has `note` alone; no special case turns it into read access. The owner's session never uses these scopes: it manages settings, keys, and connections that agents cannot reach.

## Failure

`recall` and `note` run synchronously. When the model fails, the call fails: a `recall` returns no answer rather than a guess, and a `note` reports the failure along with the changes already applied. Recall never falls back to an unfiltered list, because that would read as an answer memory never gave.

## Boundaries

```
client ──────────────▶ lib, worker types only
worker ──▶ core ─────▶ lib
```

- The client renders the worker's API, uses shared library code, and runs none of the worker's or core's code.
- The worker holds the routes, the memory service, and the memory model. Only one module opens a memory space and assembles its services, so no path skips the worker's rules.
- The core owns the log and its replay. It exposes writes, reads, history, metadata, personas, import, and export; it has no search index and no notion of relevance.
- A shared library holds rules both sides must compute the same way and generic code such as results. It imports nothing above it.

## Invariants

1. **The log is the only truth.** Every current fragment, every version, and every prompt is derived from it.
2. **Recall never writes.** Only `note`, the owner, and import add records.
3. **A receipt describes effects, not intentions.** Counts come from the writes that happened.
4. **The prefix is stable between folds.** Snapshot content does not move when new records arrive.
5. **The agent cannot change settings.** Settings are not exposed over MCP, and an agent credential reaches only MCP.
6. **Provenance is auditable.** Every record carries its source, and the UI shows it.
