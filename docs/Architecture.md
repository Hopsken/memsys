## Purpose

This document answers one question: **where does a given piece of behavior live?** It describes the layers of memsys and the rules that keep them apart. It does not describe individual plugins, limits, or wire formats; those live in the code (`contract/` for types) and in [plugin docs](plugins/).

A change that only moves a number or adds a plugin should not need an edit here. If it does, this document has leaked detail.

## Glossary

- **fragment** — one short, atomic, self-contained text; the unit of memory.
- **anchor / tag** — a `#word` inside fragment text; extracted, never stored.
- **recalled** — fragments that match the cue's words.
- **associated** — fragments sharing an anchor with a recalled fragment.
- **hub** — an anchor on a large share of the corpus; connects everything, discriminates nothing.
- **instance** — one user's memory: fragments plus configuration.

## Layers

```
┌──────────────────────────────────────────────────────┐
│  Model — volatile, outside the system, swapped        │
│  every generation                                    │
├──────────────────────────────────────────────────────┤
│  Per-instance configuration — which plugins are on   │
│  and how they are tuned                              │
├──────────────────────────────────────────────────────┤
│  Plugins — policy hooks on recall and the write      │
│  path; tool plugins that add capabilities            │
├──────────────────────────────────────────────────────┤
│  Core — remember · revise · forget · recall          │
│  contract stable for years                           │
├──────────────────────────────────────────────────────┤
│  Durable layer — fragments are the only truth;       │
│  tags and every index are rebuildable caches         │
└──────────────────────────────────────────────────────┘
```

The analogy is a file system: the durable layer is bytes on disk, the core is the syscall interface, plugins are userland programs. We borrow exactly one thing — _everything derives from the bytes; tools live outside the kernel_ — and deliberately not hierarchy, directories, or permissions. Fragments stay flat.

### The placement test

> **Remove it. Is what remains still a memory system?** Yes → plugin. No → core.

|                                  | Without it      | Layer  |
| -------------------------------- | --------------- | ------ |
| `remember` / `revise` / `forget` | cannot write    | core   |
| `recall`                         | cannot remember | core   |
| tag listing                      | tags drift      | plugin |
| ranking associations             | noisier         | plugin |
| model-based relevance filtering  | noisier         | plugin |

Any future "let's add X" starts here.

## Durable layer

- A fragment is text plus a `ref` and timestamps. Nothing else.
- Tags are derived from the text at read time and never stored.
- Every index — tag counts, IDF tables, virtual directories — is a cache computed from the corpus. Deleting it loses nothing.
- Export and import move fragments verbatim — ref, text, timestamps — between instances. Import is a user migrating memory, not an agent writing: it runs core validation but no write hooks, only adds, and is not exposed over MCP.

## Core

Four tools, the minimal complete operation set of a memory: write, change, forget, bring back.

- **The contract** — tool names, input schemas, output shape, field meanings — is meant to hold for years. New fields are additive, with defaults that reproduce prior behavior.
- **`recall` has two stages.** _Candidate generation_ finds cue matches and one-hop associations. The _terminal_ orders, filters, and truncates. Plugins attach only at the terminal.
- **`recall` returns one list**: cue matches first, then associations. An item's `via` (the shared anchors) is both its kind and the reason it was associated. `hasMore` means a higher `limit` would return more.
- **Core carries information it does not use.** `context` (what the agent is doing) is accepted and ignored by core, so read-path plugins can judge relevance against the situation. Carrying is core; using is policy.
- **Core keeps an absolute safety ceiling; policy lives in plugins.** A disabled or failing plugin can never let an unbounded fragment in. Tool descriptions carry no instance-specific numbers; warnings and rejections do.

## Plugins

### Kinds

- **Policy plugins** fill hooks. They reorder or subset recall results, and warn on or reject writes.
- **Tool plugins** add agent-visible tools.

A plugin may do both. Plugins are a compile-time registry: no dynamic loading, no inter-plugin dependency, no lifecycle, no event bus. The types are in `contract/plugin.ts`; hooks are added when a plugin first needs one.

### Pipelines

Recall:

```
candidate generation → recall hooks, in registry order → truncate to limit
```

Each hook receives the previous hook's output, so hooks chain: rank first, then filter. A hook may only reorder or drop items; the host enforces that it cannot add or rewrite them. Hooks see every candidate, before truncation.

Write path:

```
core validation → write hooks, in parallel → any rejection: store nothing, return all reasons
                                           → otherwise: store, return with warnings
```

Write hooks are independent checks, so order does not matter and results are aggregated. Rejection reasons must be actionable enough for the agent to fix its input in one retry.

### Failure

The plugin chooses how it fails, because only it knows whether not running means _a noisier result_ or _unsafe to proceed_.

- **Fail** (default) — an ordinary exception. Logged; the hook acts as identity and the pipeline continues. A broken plugin must never cost the user their memory. Plugins that call external models fail on timeouts, quota, and malformed responses, with no retry on the request path.
- **Die** — `PluginAbortError(reason)`. The pipeline stops and the call returns an error naming the plugin. On the write path nothing is stored.

Hooks that run after a write cannot abort: the fragment is already stored, and an error would mislead the agent.

### Boundaries

```
plugins → contract, lib ← worker        worker → plugins (registry)
```

`contract/` holds types both sides agree on; `lib/` holds rules both sides must compute the same way. `contract/`, `lib/`, and `plugins/` never import `worker/` or `client/`; lint enforces it. Plugin-defined values (configs, schemas, tool output) cross the Durable Object boundary as opaque JSON.

Plugins do **not** extend core tool inputs. A policy plugin works with what the core call already carries; a plugin that needs more input is a tool plugin with its own tool. The same call must never fail on one instance and succeed on another because of configuration.

## Invariants

1. **Fragments are the only truth.** Plugins see a read-only corpus. To change anything they go through the same write path the agent uses.
2. **Model judgments are never written to the durable layer.**
3. **The core contract does not change because a plugin is on.** Plugins change result quality, not the calling convention.
4. **Tool plugins are additive.** They cannot override, shadow, or redefine a core tool.
5. **Policy hooks apply only to core `recall` and the core write path.** Tool plugin output does not pass through them.
6. **The agent cannot change instance configuration.** Configuration is not exposed over MCP, and the agent's credential reaches only MCP: configuration and credential management need the user's own session. An injected agent cannot switch off its own guardrails.

## Per-instance configuration

- Stored per instance, separate from fragments, one row per plugin.
- A row is an explicit user choice. No row means follow the plugin's defaults, so improved defaults reach every untouched instance. Reset deletes the row.
- A stored value that no longer parses falls back to defaults and is shown as invalid; it never takes the instance down. Config schemas evolve additively.
- Concurrent edits are detected, not merged.
- Changes apply on the next request.
- Default configuration is the minimal instance for a good-enough model.

## Open questions

- How plugin annotations on a recall item (a score, a relevance probability) are typed. Deferred until a plugin needs one.
