## Purpose

This document answers one question: **where does a given piece of behavior live?** It describes the target shape of memsys — durable store, a four-tool core, plugins, per-instance configuration — and the rules that keep the layers apart.

## Glossary

- **fragment** — one short, atomic, self-contained text; the unit of memory.
- **anchor / tag** — a `#word` inside fragment text; extracted, never stored.
- **association key** — an anchor after splitting on `-` and stemming; what association actually compares.
- **recalled** — fragments whose text contains the cue.
- **associated** — fragments sharing an association key with a recalled fragment.
- **hub** — an anchor present on a large share of the corpus; connects everything, discriminates nothing.
- **IDF** — `ln((N+1)/(df+1))`; high for rare anchors, near zero for hubs.
- **instance** — one user's Durable Object: fragments plus configuration.

## Background: memsys today

**What it is.** A memory service for AI agents. A Cloudflare Worker fronts one Durable Object per user; each DO owns a SQLite database. Agents talk to it over MCP (five tools) or a small HTTP API; a web UI lists and edits fragments.

**Data model.** One table of _fragments_. A fragment is a short, atomic, self-contained piece of natural-language text, identified by a `ref`, with timestamps. That is the whole schema.

Tags are not stored. They are `#anchors` written inline in the text (`… #memsys #cloudflare`) and extracted on need.

### Core tools

| Tool | Does |
| --- | --- |
| `remember { fragment }` | insert; length policy per instance (`size-limit` plugin) |
| `revise { ref, fragment }` | replace the full text of a known fragment |
| `forget { ref }` | delete |
| `recall { cue, limit?, associate?, context? }` | → `{ fragments: (Fragment & { via? })[], hasMore }`; see below |

**How `recall` works**

1. **Recalled** — fragments whose match the cue, by words or semantically.
2. **Associated** — every _other_ fragment that shares an anchor with any recalled fragment. Anchor comparison goes through _association keys_.

Step 1 is the direct hit. Step 2 is spreading activation over the tag graph — it exists to surface things the agent did not know to ask for.

**Worked example.** With the fixture in [[Memsys 测试语料]] (8 fragments; `#memsys` on 5 of them), `recall("美西")` returns f2 as recalled, and as associated f1, f4, f6, f7 — f1 and f7 because they share `cloudflare` / `d1` with f2, f4 and f6 only because they share the ubiquitous `#memsys`. All four are ordered by date, so the two weak matches are interleaved with the two strong ones.

**What is wrong with it.** Three things, all visible in that example:

1. **Hub anchors dominate association.** A tag on half the corpus connects everything to everything. Sorting associated by date, not by specificity, means the noise is not even at the bottom.
2. **Association cannot be turned off.** Fetching standing instructions (`recall("#must-read")` at session start) drags in every neighbor of those fragments. The agent pays the noise tax on every session.
3. **There is nowhere to put per-user policy.** Everyone gets the same behavior. There is no way to make one instance stricter or to give a stronger model more tools without changing the code for all.

There is a fourth, structural problem: anything we might add — ranking, gating, lint, a search DSL — has no home other than "inside `recall`" or "another top-level tool", and both grow the contract that is supposed to stay stable.

## Target architecture

```
┌──────────────────────────────────────────────────────┐
│  Model — volatile, outside the system, swapped        │
│  every generation                                    │
├──────────────────────────────────────────────────────┤
│  Per-instance configuration — one per user; which    │
│  plugins are on and how they are tuned               │
├──────────────────────────────────────────────────────┤
│  Plugins — policy hooks that extend recall and the   │
│  write path; tool plugins that add capabilities      │
├──────────────────────────────────────────────────────┤
│  Core — remember · revise · forget · recall          │
│  contract stable for years                           │
├──────────────────────────────────────────────────────┤
│  Durable layer — fragments are the only truth;       │
│  tags and every index are rebuildable caches         │
└──────────────────────────────────────────────────────┘
```

The analogy is a file system: the durable layer is bytes on disk, the core is the syscall interface, plugins are userland programs. We borrow exactly one thing from the analogy — _everything derives from the bytes; tools live outside the kernel_ — and deliberately not hierarchy, directories, or permissions. Fragments stay flat.

### The placement test

> **Remove it. Is what remains still a memory system?** Yes → plugin. No → core.

|                                  | Without it        | Layer               |
| -------------------------------- | ----------------- | ------------------- |
| `remember` / `revise` / `forget` | cannot write      | core                |
| `recall`                         | cannot remember   | core                |
| `list_tags`                      | works; tags drift | plugin, default on  |
| IDF ordering of associated       | works; noisier    | plugin, default on  |
| Jev model gating                 | works             | plugin, default off |

The test does not depend on taste. Any future "let's add X" starts here.

## Durable layer

- A fragment is dumb text plus `ref` and timestamps. Nothing else.
- Tags are derived at read time from the text. They are never stored. Keep it that way.
- Every index — tag counts, IDF table, time windows, memfs's virtual directories — is a cache computed from the corpus. Deleting it loses nothing.

## Core

Four tools. They are the minimal complete operation set of a memory: write, change, forget, bring back.

- The contract — tool names, input schemas, output shape, field meanings — is meant to hold for years. New fields are additive with defaults that reproduce prior behavior.
- `recall` is split into **candidate generation** (substring → recalled; one-hop anchor spread → associated) and a **terminal** (order, filter, truncate, return). Plugins attach only at the terminal.
- `recall` stays a pure function: `recall(corpus, input, plugins, index) → result`. Tests pass an empty plugin list or stubs.
- `recall` returns one list: cue matches first, then associated fragments. An item's `via` (the shared anchors) is both its kind and the reason it was associated; there is no separate `kind` field. `limit` bounds the combined list; `hasMore` reports that candidates were omitted.
- Length policy (soft/hard, default 300/500) lives in the `size-limit` plugin. Core keeps only an absolute ceiling, `FRAGMENT_MAX` = 1000 graphemes (`lib/fragment.ts`), so a disabled or failing plugin can never let an unbounded fragment in. Tool descriptions carry no instance-specific numbers; warnings and rejections do.

RFC 4's `associate` and `limit` fields are additive core contract, not plugins. So is `context` (optional free text: what the agent is doing right now). Core accepts it and ignores it; it exists so that read-path plugins can judge relevance against the situation, not just the cue. Carrying the information is core; using it is policy.

## Plugin system

### Interface

```ts
type Verdict = { warnings: string[]; rejections: string[] };

type Plugin<C> = {
  name: string;
  title: string; // for the config UI
  description: string;
  config: z.ZodType<C>; // validates this plugin's slice of instance config
  defaults: { enabled: boolean; config: C };

  // Tool plugin: static, so the worker can register MCP tools without a corpus. Additive only.
  tools?: ToolDef<C>[];

  // Policy hook: recall terminal. Receives the parsed recall input (cue, context, …).
  afterRecall?: (
    ctx: Ctx<C>,
    items: readonly RecallItem[],
    input: RecallInput
  ) => Promise<RecallItem[]>;

  // Policy hooks: write path. remember and revise are separate lifecycles;
  // a plugin may share one implementation between them.
  beforeRemember?: (ctx: Ctx<C>, text: string) => Promise<Verdict>;
  beforeRevise?: (
    ctx: Ctx<C>,
    prev: Fragment,
    text: string
  ) => Promise<Verdict>;
  afterRemember?: (ctx: Ctx<C>, stored: Fragment) => Promise<Related[]>;
};

type ToolDef<C> = {
  name: string;
  description: string;
  input: z.ZodObject; // MCP SDK takes zod and emits JSON Schema
  annotations?: ToolAnnotations;
  run: (ctx: Ctx<C>, input: unknown) => Promise<unknown>;
};

// Fields are added when a plugin first needs them; today only config, corpus, index exist.
type Ctx<C> = {
  config: C;
  corpus: ReadonlyMap<string, Fragment>; // read-only view
  index: { anchors(ref: string): string[] }; // anything else (df, …) plugins derive themselves
  write: { remember; revise; forget }; // the core write path, hooks included
  fetch: typeof fetch; // injectable for tests
};
```

Hooks are implemented only when a plugin needs them. Implemented: `size-limit` (`beforeRemember` + `beforeRevise`), `list-tags` (tool), and `idf` (`afterRecall`).

### Code layout

```
contract/   what worker and plugins must agree on: types (Fragment, Plugin, …)
lib/        shared runtime helpers (fragment length, relative dates)
plugins/    one file per plugin + index.ts (the registry array)
worker/     core + plugin host
```

`plugins → contract, lib ← worker`, plus `worker → plugins/index.ts`. `contract/`, `lib/`, and `plugins/` never import `worker/` or `client/`; lint enforces it. Worker and plugins meet only at the contract; `lib/` holds rules both sides must compute the same way, such as fragment length.

`definePlugin` erases each plugin's config type for the registry and re-parses the config at every hook call, so a plugin always receives its own config type.

Plugin-defined values (configs, JSON Schemas, tool output) are opaque JSON at the Durable Object RPC boundary: tool calls return JSON text, and plugin-config methods return HTTP `Response`s the worker passes through.

Plugins are a compile-time array in the worker. There is **no** dynamic loading, no inter-plugin dependency, no lifecycle, no event bus.

Plugins do **not** extend the input schema of core tools. A policy plugin works with what `recall` already carries (`cue`, `context`, `associate`, `limit`). If a plugin needs input beyond that, it is a tool plugin with its own tool. This keeps the core schema identical across instances: the same call never fails on one instance and succeeds on another because of configuration.

### Two kinds

- **Policy plugins** fill only hooks. They reorder, subset, or annotate recall results; they warn on or reject writes. They add no tools. Examples: IDF ordering, Jev gating, hub warning.
- **Tool plugins** fill only `tools`. They add agent-visible capabilities. Examples: `list_tags`, memfs.

A plugin may do both; nothing needs to yet.

### Pipelines

Recall terminal, fixed order, not configurable:

```
candidate generation → afterRecall hooks, in registry order → truncate to limit → return
```

Each hook receives the previous hook's output and may reorder or drop items. The host keeps only refs from its input, deduplicated, and returns the host's own copies, so a hook cannot add, duplicate, or rewrite items; annotations wait on the open question below. Hooks run before truncation, so they may see more candidates than `limit`. `hasMore` describes candidate generation and is never rewritten by plugins. `idf` sorts associated items by the summed IDF of their `via` anchors; cue matches keep their place, and ties keep recency.

Write path:

```
core validation (hard limit) → all beforeRemember in parallel
  → if any rejection: do not store, return isError with ALL reasons aggregated
  → store → all afterRemember in parallel → return { fragment, warnings, related }
```

Rejection reasons must be readable and actionable so the agent can fix its input in one retry.

### Failure

A hook can end in two ways besides success, and the plugin chooses which at the moment of failure — only it knows whether not running means _a noisier result_ or _unsafe to proceed_.

- **Fail** — any ordinary exception. Logged; the hook is treated as identity (`afterRecall` returns its input, `beforeRemember` returns no warnings and no rejections, `afterRemember` returns nothing); the pipeline continues. This is the default: most failures are bugs or environment, and a broken plugin must never cost the user their memory.
- **Die** — the plugin throws `PluginAbortError(reason)`. The pipeline stops; the tool call returns `isError` naming the plugin and the reason. On the write path nothing is stored.

`afterRemember` cannot abort. The fragment is already stored, and an error after a successful write would mislead the agent. A plugin that needs a veto uses `beforeRemember`.

Plugins that call external models (Jev) fail — not die — on missing key, timeout (~1.5 s budget), rate limit, and malformed response, with no retry on the request path.

## Invariants

1. **Fragments are the only truth.** Plugins see a read-only corpus. To change anything they go through `ctx.write`, the same path the agent uses. A dedup plugin cannot merge; it can only return `related` and let the agent `revise`.
2. **Model judgments are never written to the durable layer.**
3. **The core contract does not change because a plugin is on.** Plugins change result quality, not the calling convention. The same agent code runs against any instance.
4. **Tool plugins are additive.** They cannot override, shadow, or redefine a core tool.
5. **Policy hooks apply only to core `recall` and the core write path.** Tool plugin output does not pass through `afterRecall` — memfs is raw by construction, not by convention.
6. **The agent cannot change instance configuration.** It is not exposed over MCP. An injected agent cannot switch off its own guardrails.

## Per-instance configuration

- Stored in the instance's SQLite, table `plugin_config(name, enabled, config json, updated_at)`, one row per plugin. Separate from fragments.
- A row is an explicit user choice; no row means follow the plugin's `defaults`, so improved defaults reach every untouched instance. Reset = delete the row.
- Effective config = `safeParse(stored) ?? defaults`. A stored value that no longer parses is logged and shown as `invalid`; it never takes the instance down. Config schemas evolve additively (new fields carry `.default()`).
- Writes carry the `updated_at` they read; a mismatch is a conflict (409).
- Unknown plugin names and schema violations are rejected with a path.
- Changes apply on the next request. Tool-list changes reach MCP clients on reconnect (stateless server, no `list_changed`).
- Edited through `GET/PUT/DELETE /api/plugins[/:name]` and a schema-driven form in the web UI (`z.toJSONSchema` of each plugin's `config`). Keeping agents out of that endpoint waits for real OAuth; Access is a stopgap.
- Default configuration = the minimal instance for a good-enough model: four core tools + `list_tags` + `size-limit` + `idf`.

## Open questions

- How plugin annotations on a recall item (`score`, later others) are typed. Deferred until a plugin needs one.
- memfs `grep`: regex (faithful to Bash) or substring (consistent with `recall`). Leaning faithful; memfs is a separate entry point and `-F` exists.
