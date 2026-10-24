## Purpose

This document answers one question: **where does a given piece of behavior live?** It describes the layers of memsys and the rules that keep them apart. It does not describe individual features, limits, or wire formats; those live in the code and in [Features](features.md).

A change that only moves a number or adds a setting should not need an edit here. If it does, this document has leaked detail.

## Glossary

- **fragment** — one short, atomic, self-contained text; the unit of memory.
- **anchor / tag** — a `#word` inside fragment text; extracted, never stored.
- **recalled** — fragments that match the cue's words.
- **associated** — fragments sharing an anchor with a recalled fragment.
- **hub** — an anchor on a large share of the corpus; connects everything, discriminates nothing.
- **instance** — one user's memory: fragments plus settings.
- **feature** — behavior the owner can switch off or tune under **Settings → Features**.

## Layers

```
┌──────────────────────────────────────────────────────┐
│  Model — volatile, outside the system, swapped        │
│  every generation                                    │
├──────────────────────────────────────────────────────┤
│  Per-instance settings — which features are on and   │
│  how they are tuned                                  │
├──────────────────────────────────────────────────────┤
│  Core — remember · revise · forget · recall,         │
│  list_tags; contract stable for years                │
├──────────────────────────────────────────────────────┤
│  Durable layer — fragments are the only truth;       │
│  tags and every index are rebuildable caches         │
└──────────────────────────────────────────────────────┘
```

The analogy is a file system: the durable layer is bytes on disk, the core is the syscall interface. We borrow exactly one thing — _everything derives from the bytes_ — and deliberately not hierarchy, directories, or permissions. Fragments stay flat.

### The placement test

> **Does the owner have a reason to turn it off or tune it?** Yes → a feature with a setting. No → always on, or removed.

A reason is something the owner can weigh: money, latency, how strict a check is. "It might be worse" is not one; that is for the eval to decide, and then the behavior is kept or removed for everyone.

|                                  | Owner's reason to change it | Place     |
| -------------------------------- | --------------------------- | --------- |
| `remember` / `revise` / `forget` | none                        | always on |
| `recall`, tag listing            | none                        | always on |
| ranking associations             | none                        | always on |
| length limits                    | how short memories must be  | feature   |
| model-based relevance filtering  | cost, latency, strictness   | feature   |

Any future "let's add X" starts here. Features are code in this repo, not plugins: there is no registry, no hooks, and no loading ([RFC 0004](rfcs/0004-memory-core.md)).

## Durable layer

- A fragment is text plus a `ref` and the time `at` it was written. Nothing else.
- The durable state is an append-only log of fragment snapshots; `forget` appends a record with no text. The current corpus is its replay. Only the user can delete records, by purging a fragment.
- Tags are derived from the text at read time and never stored.
- Every index — tag counts, IDF tables, virtual directories — is a cache computed from the corpus. Deleting it loses nothing.
- Export and import move the log verbatim — ref, text, time — between instances. Import is a user migrating memory, not an agent writing: it runs core validation but not the owner's length limits, only adds, and is not exposed over MCP.

## Core

Four tools, the minimal complete operation set of a memory: write, change, forget, bring back.

- **The contract** — tool names, input schemas, output shape, field meanings — is meant to hold for years. New fields are additive, with defaults that reproduce prior behavior.
- **`recall` is one method**: match the cue, spread to associations, rank them, filter if the owner turned the filter on, cut to the result size ([RFC 0002](rfcs/0002-recall-contract.md) fixes the contract). The agent sends only `cue` and `context`.
- **`recall` returns one list**: cue matches first, then associations. An item's `via` (the shared anchors) is both its kind and the reason it was associated. `truncated` means a more specific cue would bring back memories that were left out.
- **Core carries information only a feature uses.** `context` (what the agent is doing) is accepted on every recall; only the relevance filter reads it.
- **Core keeps an absolute safety ceiling; the owner's limits sit under it.** No setting can let an unbounded fragment in. Tool descriptions carry no instance-specific numbers; warnings and rejections do.

## Recall

```
match → spread → rank → relevance filter (if on) → cut
```

Each step is a typed function with its own bounds. Only the cut knows the result size. `truncated` is set when a step drops a cue match; a dropped association is not reported, since a better cue does not bring it back. A new step is a new function call here, kept if the eval shows it helps.

## Write path

```
core validation → the owner's length limits → too long: store nothing, return the reason
                                            → otherwise: store, return with any warning
```

Rejection reasons must be actionable enough for the agent to fix its input in one retry. Import is a user migrating memory: it runs core validation only.

## Failure

A feature that judges candidates fails the call rather than passing on what it did not check: an unfiltered list would read as a checked one. It retries within its own deadline first, and its error says whether retrying the call can help.

## Boundaries

```
client ──────────────▶ lib, worker (types only)
worker ──▶ core ─────▶ lib
```

Each type belongs to the module that owns its meaning. `lib/` holds rules both sides must compute the same way, including the analyzer the core indexes with, and generic code such as results. It never imports the core, the Worker, or the client.

The client infers the Worker API's types from the Worker and runs none of its code; it never imports the core.

`core/` is the memory core: the fragment log, its search and anchor indexes, and untyped metadata by key, in one Durable Object per memory space. It knows nothing of recall policy, settings, models, or HTTP, and apps reach it only through its entry point ([RFC 0004](rfcs/0004-memory-core.md)).

`worker/` is laid out as routes, services, and clients. Routes speak HTTP and MCP; services hold the rules and import no HTTP or platform API; clients call outside services; middlewares sign the caller in. Every call to a memory space goes through one service per request, so none skips the Worker's rules, and only one module touches the memory binding. Only per-request values, who is calling and what they may do, travel with the request.

Failures are values with a canonical code, a reason, and a message written where they are made ([RFC 0004](rfcs/0004-memory-core.md)). Only the code decides the HTTP status, in one place. Lint enforces all of these boundaries.

Features do **not** extend core tool inputs. The same call must never fail on one instance and succeed on another because of a setting's shape; settings change result quality, not the calling convention.

## Invariants

1. **Fragments are the only truth.** Recall reads a snapshot of the corpus and never writes.
2. **Model judgments are never written to the durable layer.**
3. **The core contract does not change because a feature is on.** Features change result quality, not the calling convention.
4. **The agent cannot change settings.** Settings are not exposed over MCP, and the agent's credential reaches only MCP: settings and credential management need the user's own session. An injected agent cannot switch off its own guardrails.

## Per-instance settings

- One typed object, kept as a metadata document in the memory object, separate from fragments.
- A missing field means its default, so a document saved before a field existed still loads, and a field that no longer parses falls back to its default on its own; it never takes the instance down.
- A save takes a JSON Merge Patch: given fields replace stored ones, `null` returns a field to its default. The last save of a field wins.
- Changes apply on the next request.
- The defaults are the minimal instance for a good-enough model.
