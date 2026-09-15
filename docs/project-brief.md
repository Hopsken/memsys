# memsys

> A tiny associative memory system for agents.

## 1. Overview

**memsys** is a minimal long-term memory system for AI agents.

It models memory as a collection of small, atomic **fragments**. A fragment is plain text and may contain hashtags. Those hashtags act as explicit memory **anchors**, allowing fragments to become associated without storing links or graph edges.

```text
Fragment A ── #memsys ── Fragment B
                   │
                   └──── Fragment C
```

Only fragments are persisted.

Tags, associations, and the resulting graph are derived projections of fragment content.

The core idea is simple:

> Memory is made of fragments connected by shared anchors.

---

## 2. Goals

memsys should provide agents with a memory primitive that is:

- small enough to understand completely
- explicit rather than semantically inferred
- easy to inspect and edit
- recallable from simple textual cues
- naturally associative through shared anchors
- cheap to run on Cloudflare

The first version should remain intentionally narrow. memsys is a memory primitive, not a general-purpose knowledge base.

---

## 3. Product Philosophy

### 3.1 Memory is fragmented

A fragment should usually express one small idea:

```text
memsys uses Durable Objects for persistent memory.
#memsys #cloudflare #architecture
```

Long notes containing many unrelated ideas should be split into multiple fragments.

The value comes from connecting many small pieces rather than building large documents.

### 3.2 The fragment is the source of truth

The only canonical domain entity is the fragment.

Hashtags live directly inside fragment text:

```text
Associations should come from explicit anchors.
#memsys #architecture
```

Everything else can be derived:

```text
anchors
associations
graph structure
```

There are no canonical entities such as:

```text
tags
fragment_tags
links
edges
```

Any derived index should be disposable and fully rebuildable from fragments.

### 3.3 Hashtags are memory anchors

Hashtags establish explicit association points.

```text
Durable Objects are a good fit for memsys.
#memsys #cloudflare #architecture

Recall starts from a textual cue.
#memsys #recall #design
```

These fragments become associated through the shared `#memsys` anchor.

memsys never needs to create an explicit link between them.

### 3.4 Recall begins with a cue

Agents rarely recall memory by primary key. They usually have a small textual clue:

```text
"cloudflare memory"
"durable objects"
"memory anchors"
```

memsys calls this input a **cue**.

`recall(cue)` uses lexical matching against fragment text to locate likely memories.

The baseline implementation should favor simple, deterministic matching over aggressive fuzzy behavior. More advanced matching strategies are intentionally left open for experimentation.

### 3.5 Association follows anchors

Once a fragment is recalled, memsys extracts its hashtags and surfaces other fragments that share those anchors.

```text
cue
 ↓
Fragment A
 ↓
#memsys #cloudflare
 ↓
Fragment B
Fragment C
Fragment D
```

This creates two deliberately separate mechanisms:

```text
cue → fragment
lexical recall

fragment → anchors → fragments
explicit association
```

Text matching helps locate the initial memory.

Hashtags define what that memory is associated with.

---

## 4. Core Vocabulary

### Fragment

The smallest persistent unit of memory.

```text
Durable Objects can keep a memory corpus in process memory.
#memsys #cloudflare #architecture
```

A good fragment is:

- short
- atomic
- self-contained
- optionally anchored with hashtags

### Anchor

A hashtag parsed from fragment text.

```text
#memsys
#cloudflare
#architecture
#project/minisphere
#decision/storage
```

Anchors are derived data. They do not have an independent lifecycle.

`/` may be used as a lightweight namespace:

```text
#project/minisphere
#concept/memory
#decision/storage
#person/alice
```

### Cue

A piece of text supplied to `recall` as a memory clue.

```text
"cloudflare storage"
```

A cue is textual and does not refer to a fragment ID.

### Association

A relationship that exists when two fragments share one or more anchors.

```text
Fragment A
   │
#cloudflare
   │
Fragment B
```

Associations are runtime projections rather than persisted edges.

### Ref

An opaque identity returned after a fragment has been found or created.

Refs exist so an agent can precisely revise or forget a known fragment. They are not part of the recall model.

---

## 5. MCP API

The initial MCP surface contains four tools:

```text
remember
recall
revise
forget
```

### `remember`

Stores a new fragment.

```ts
remember({
  fragment: string
})
```

Example:

```ts
remember({
  fragment: `
    memsys uses Durable Objects for persistent memory.
    #memsys #cloudflare #architecture
  `
})
```

Possible response:

```ts
{
  ref: "01K...",
  fragment: "...",
  createdAt: "..."
}
```

### `recall`

Recalls fragments from a textual cue and surfaces associated fragments.

```ts
recall({
  cue: string
})
```

Example:

```ts
recall({
  cue: "cloudflare memory"
})
```

Possible response:

```ts
{
  recalled: [
    {
      ref: "01K...",
      fragment: "...",
      anchors: [
        "memsys",
        "cloudflare",
        "architecture"
      ]
    }
  ],

  associated: [
    {
      ref: "01K...",
      fragment: "...",
      sharedAnchors: [
        "memsys",
        "cloudflare"
      ]
    }
  ]
}
```

`recall` is read-only in the MVP.

### `revise`

Edits the content of a known fragment through MCP.

```ts
revise({
  ref: string,
  old_string: string,
  new_string: string,
  replaceAll: false, // Optional; true replaces all non-overlapping matches.
});
```

`old_string` must be non-empty and match exactly, including case and whitespace. By default it must match once; `replaceAll: true` replaces all non-overlapping matches. No match is an error in either mode. `new_string` replaces matches literally and may be empty. The result must be non-blank and at most 4096 characters; failed revisions leave the fragment unchanged. MCP uses `inputs.revise`. REST uses a separate schema, `{ ref, fragment }`, to replace the full content without old text. Both paths share the final content validation and storage update.

Changing the text may change its anchors and therefore its derived associations.

### `forget`

Removes a known fragment.

```ts
forget({
  ref: string
})
```

Once removed, every association produced by that fragment disappears naturally because associations are derived.

---

## 6. Recall Model

Recall has two stages.

### Stage 1 — Cue Recall

```text
cue
 ↓
lexical matching
 ↓
matching fragments
```

The baseline should remain intentionally simple and predictable. A first implementation can normalize case and whitespace and perform straightforward lexical or substring matching against fragment content.

For example:

```text
cue:      "durable objects"
fragment: "Durable Objects are a good fit for memsys."
```

The exact baseline matching behavior is an implementation detail, but it should avoid semantic inference and aggressive approximation.

This stage only answers which fragments match the cue.

### Stage 2 — Associative Recall

For each recalled fragment:

```text
extract hashtags
       ↓
find fragments sharing those hashtags
```

Example:

```text
memsys keeps its active corpus in memory.
#memsys #cloudflare #architecture
```

Produces the anchors:

```text
#memsys
#cloudflare
#architecture
```

Those anchors are then used to surface related fragments.

Association uses exact normalized anchor equality. It does not use fuzzy matching, embeddings, or semantic inference.

---

## 7. Cloudflare Architecture

The MVP architecture is:

```text
              MCP Client
                   │
                   │ Streamable HTTP
                   ▼
          Cloudflare Worker
                   │
                   │ RPC
                   ▼
           Memory Durable Object
          ┌────────┴─────────┐
          │                  │
          ▼                  ▼
      SQLite          in-memory corpus
   persistent            derived
     memory               state
```

### MCP Worker responsibilities

```text
MCP protocol handling
authentication
memory-space routing
input validation
```

### Memory Durable Object responsibilities

```text
fragment persistence
in-memory fragment corpus
lexical recall
anchor extraction
association projection
```

A single Durable Object represents one isolated memory space.

```text
MemoryDO(user-a)
MemoryDO(user-b)
MemoryDO(agent-a)
```

---

## 8. Persistent and Active Memory

SQLite stores canonical long-term state:

```text
SQLite
└── fragments
```

The Durable Object may keep an ephemeral copy of the fragment corpus in memory:

```text
MemoryDO
└── fragments
```

On initialization:

```text
SQLite
 ↓
load all fragments
 ↓
build in-memory corpus
```

While the Durable Object remains warm, recall can operate directly over that in-memory corpus.

If the object is evicted, its in-memory state disappears. A later instance rebuilds that state from SQLite.

This gives memsys a clean separation:

```text
SQLite = durable memory
in-memory corpus = ephemeral active state
```

Any future search index must remain derived and rebuildable from the fragment corpus.

---

## 9. Data Model

The MVP needs one table:

```sql
CREATE TABLE fragments (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

There are no persistent tables for:

```text
tags
fragment_tags
links
edges
vectors
embeddings
```

`id` is storage identity.

The MCP layer exposes it as an opaque `ref` after a fragment has been created or recalled.

---

## 10. In-Memory Representation

A warm Memory Durable Object may keep:

```ts
class MemoryDO {
  fragments: Map<string, Fragment>
}
```

Because the corpus is already in memory, both baseline recall and association resolution can operate without persistent reads on every request.

Association can initially be resolved by scanning fragments:

```text
recalled fragment
       ↓
extractAnchors()
       ↓
scan in-memory fragments
       ↓
associated fragments
```

If corpus size eventually makes this expensive, memsys can add ephemeral derived indexes such as:

```ts
Map<Anchor, Set<FragmentRef>>
```

or a search-specific structure.

Any such index remains derived state and can always be rebuilt from fragment content.

---

## 11. Operation Lifecycle

### Remember

```text
remember(fragment)
       ↓
SQLite INSERT
       ↓
update in-memory corpus
```

### Recall

```text
recall(cue)
       ↓
lexical match against corpus
       ↓
recalled fragments
       ↓
extract anchors
       ↓
resolve associations
       ↓
return recalled + associated
```

Recall does not mutate persistent state in the MVP.

### Revise

```text
revise(ref, fragment)
       ↓
SQLite UPDATE
       ↓
update in-memory corpus
```

Any anchor changes are reflected automatically in future associations.

### Forget

```text
forget(ref)
       ↓
SQLite DELETE
       ↓
remove from in-memory corpus
```

No relationship cleanup is required because relationships are derived.

---

## 12. Hashtag Grammar

The hashtag syntax should remain intentionally small.

A reasonable starting grammar is:

```text
#[letters|numbers|_|-|/]+
```

Examples:

```text
#memory
#agent-memory
#project/minisphere
#decision/use-do
#concept/oauth
```

Anchors should be normalized for comparison:

```text
#Cloudflare
#cloudflare
```

Both become:

```text
cloudflare
```

Exact normalized equality defines an association.

---

## 13. Scaling Model

The initial target is a personal or agent-specific corpus containing many short fragments.

A cold Durable Object instance performs:

```text
N fragments
     ↓
N SQLite rows read
     ↓
rebuild in-memory corpus
```

A warm recall performs:

```text
in-memory lexical matching
+
in-memory association lookup
```

The first scaling boundary is therefore corpus size and matching cost rather than persistent query complexity.

The initial strategy is deliberately simple:

```text
small / medium memory space
→ full in-memory corpus

large memory space
→ revisit the indexing strategy when real usage requires it
```

Premature sharding or persistent search indexes would add complexity without improving the core model.

---

## 14. MVP Scope

Version `0.1` contains exactly four MCP tools:

```text
remember
recall
revise
forget
```

And exactly one persistent domain entity:

```text
fragment
```

### Technology

```text
Cloudflare Workers
Cloudflare Durable Objects
SQLite-backed Durable Object storage
MCP
```

### Core capabilities

- atomic text fragments
- hashtags embedded directly in fragment text
- simple lexical cue recall
- exact hashtag association
- automatic associated-fragment expansion
- durable fragment persistence
- reconstruction of ephemeral in-memory state

---

## 15. Explicitly Deferred

The following are outside the MVP:

```text
vector search
embeddings
semantic similarity
fuzzy search
stemming / lemmatization
LLM-generated relationships
explicit graph edges
tag entities
folders
documents
pages
rich note hierarchy
automatic summarization
automatic forgetting
memory strength / reinforcement
recall history
memory scoring formulas
```

Memory reinforcement is intentionally left open. A useful design may require richer recall history than a counter or a single `last_recalled_at` timestamp, so the MVP should avoid committing to a persistence model prematurely.

Recall matching beyond the simple lexical baseline is also intentionally left open. It should be introduced experimentally only when it improves recall quality without creating excessive noise.

---

## 16. Open Questions

### Recall matching

The right amount of approximation in `recall` is unresolved.

Traditional fuzzy search tools such as Fuse.js are primarily useful when queries contain misspellings or approximate character sequences. Agent-generated cues are less likely than human input to contain spelling mistakes, so typo tolerance may introduce more noise than value.

Morphological matching may be more useful. For example:

```text
handle
handled
handling
```

These forms express closely related lexical intent while simple string matching may treat them independently.

Potential experiments include:

- case and whitespace normalization
- token-based matching
- stemming
- lemmatization
- morphology-aware matching
- Fuse.js or similar fuzzy matching as an optional layer

None of these are part of the core memory model. They should be evaluated empirically against real agent recall behavior before becoming default behavior.

### Memory reinforcement

Repeated recall may eventually strengthen a memory, inspired by how biological memory becomes reinforced through reuse.

The representation is unresolved. Possible future designs may involve recall events, temporal patterns, decay, or another model entirely.

For now, `recall` remains read-only.

### Association breadth

A common anchor may connect a large number of fragments. The MVP should return a bounded number of associated fragments, but the exact limit and selection behavior should be determined from usage.

### Fragment size

The product should encourage small fragments without enforcing an arbitrary hard semantic boundary. A practical size limit may still be useful for storage and MCP response control.

---

## 17. Design Principles

### Fragments over documents

Memory stays small and composable.

### Anchors over inferred relationships

Explicit hashtags define association.

### Cues over IDs

Recall begins with a textual clue rather than a database identity.

### Derived structure over duplicated state

Tags and graph relationships come from fragment content.

### Predictable recall over aggressive approximation

The baseline recall mechanism should remain easy to reason about. More tolerant matching belongs behind experiments until it demonstrates better recall quality.

### Small API surface

```text
remember
recall
revise
forget
```

The API should feel like interacting with memory rather than manipulating database records.

---

## 18. Definition

memsys can be described in one sentence:

> **memsys is a tiny associative memory system where agents remember fragments, recall them from textual cues, and rediscover related memories through shared anchors.**

Or more conceptually:

> **Fragments are memories. Hashtags are anchors. Cues trigger recall. Shared anchors create association.**
