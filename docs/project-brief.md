# memsys

> A tiny associative memory system for agents.

## 1. Overview

**memsys** 是一个面向 AI Agent 的极简长期记忆系统。

它把记忆建模为大量小型 **fragments**。每个 fragment 是一段简短、原子化的文本，其中可以包含 hashtags。Hashtag 作为 memory anchor，使多个 fragments 自然形成关联。

```text
Fragment A ── #memsys ── Fragment B
                   │
                   └──── Fragment C
```

系统只持久化 fragments。

Tags、links、graph 都是从 fragment 内容中派生出来的 projection。

核心思想：

> Memory is made of fragments connected by shared anchors.

---

## 2. Product Philosophy

### 2.1 Memory is fragmented

memsys 鼓励保存小而明确的记忆：

```text
Minisphere uses D1 for persistent storage.
#minisphere #d1
```

而非一篇包含多个主题的长篇 note。

一个 fragment 尽量表达一件事情。

完整认知来自大量 fragments 之间的连接。

### 2.2 Fragment is the source of truth

系统唯一的核心数据实体是：

```text
Fragment
```

Hashtag 直接存在于 fragment 文本：

```text
Agent memory should use explicit anchors.
#memsys #architecture
```

系统可以随时从 fragment 内容派生：

```text
anchors
associations
graph
```

因此不存在需要独立维护的：

```text
tags
fragment_tags
links
edges
```

派生数据应该始终可以从 fragments 完整重建。

### 2.3 Hashtags are memory anchors

Hashtag 的作用是建立明确的记忆锚点。

例如：

```text
Cloudflare Durable Objects are a good fit for memsys.
#memsys #cloudflare #architecture

Fuse.js can provide lexical fuzzy recall.
#memsys #recall #fusejs
```

两个 fragments 因共享：

```text
#memsys
```

自然产生关联。

系统无需显式创建 link。

### 2.4 Retrieval starts from a cue

Agent 回忆信息时通常只有一个模糊线索：

```text
"cloudflare memory"
"fuzzy recall"
"the thing about durable objects"
```

memsys 把这个输入称为：

```text
cue
```

`recall(cue)` 使用 lexical fuzzy matching 从 fragments 中找到最符合这个线索的记忆。

这个阶段模拟：

> “我隐约记得有这么一件事。”

### 2.5 Association follows anchors

找到 initial fragment 后，系统解析其中的 hashtags，并带出共享这些 anchors 的 fragments。

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

这里形成两个明确分层：

```text
cue → fragment
lexical fuzzy recall

fragment → anchors → fragments
explicit association
```

MVP 的 recall 使用 lexical fuzzy matching。

Association 使用 exact hashtag matching。

### 2.6 Retrieval reinforces memory

真正被 `recall` 命中的 fragment 会被强化：

```text
recall_count += 1
last_recalled_at = now
```

通过 association 被带出的 fragments 只处于外围激活状态。

它们在被进一步主动 recall 时才得到 reinforcement。

因此：

```text
direct recall
    ↓
reinforcement

association
    ↓
context activation
```

memsys 保存这些客观行为数据。

Agent 可以利用这些数据理解：

```text
frequently recalled memories
recent memories
long-dormant memories
```

---

# 3. Core Vocabulary

## Fragment

memsys 中最小的 memory unit。

```text
Durable Objects can keep a Fuse index in memory.
#memsys #cloudflare #architecture
```

原则：

- short
- atomic
- self-contained
- optionally anchored with hashtags

## Anchor

从 fragment 中解析出的 hashtag。

```text
#memsys
#cloudflare
#architecture
#project/minisphere
#decision/storage
```

Anchor 本身属于 derived information。

推荐支持 `/`，方便形成轻量 namespace：

```text
#project/minisphere
#concept/memory
#decision/storage
#person/alice
```

## Cue

传递给 `recall` 的自然语言线索：

```text
"cloudflare storage"
```

Cue 本身无需是精确关键词，也无需对应 fragment ID。

## Association

两个 fragments 共享一个或多个 anchors 时产生的关系。

```text
Fragment A
   │
#cloudflare
   │
Fragment B
```

Association 是运行时 projection。

## Reinforcement

Fragment 被主动 recall 后记录的使用历史：

```text
recall_count
last_recalled_at
```

---

# 4. MCP API

memsys 对外提供极小的 MCP surface。

## `remember`

保存一个新的 fragment。

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

Returns:

```ts
{
  ref: string
  fragment: string
  createdAt: string
}
```

`ref` 是内部 identity，用于之后对明确 fragment 执行 mutation。

Agent 无需通过 `ref` 进行 recall。

---

## `recall`

根据模糊记忆线索进行回忆。

```ts
recall({
  cue: string
})
```

Example:

```ts
recall({
  cue: "cloudflare memory storage"
})
```

可能返回：

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
      ],
      recallCount: 8,
      lastRecalledAt: "..."
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

`recalled` 中的 fragments 得到 reinforcement。

`associated` 中的 fragments 保持原有 reinforcement 状态。

---

## `revise`

修改已经明确找到的 fragment。

```ts
revise({
  ref: string,
  fragment: string
})
```

Revision 会同步更新：

```text
persistent fragment
Fuse index
derived anchor relationships
```

无需显式更新 tags 或 links。

---

## `forget`

删除已经明确找到的 fragment。

```ts
forget({
  ref: string
})
```

删除后，该 fragment 产生的所有关联自然消失。

---

# 5. Recall Model

Recall 分成两个阶段。

## Stage 1 — Cue Recall

```text
cue
 ↓
Fuse.js
 ↓
matching fragments
```

Fuse.js 提供轻量 lexical fuzzy matching，例如可以容忍：

```text
cloudflare
clodflare

memory storage
memry storag
```

搜索对象只有 fragment 原始文本。

MVP 可以采用类似：

```ts
new Fuse(fragments, {
  keys: ["fragment"],
  threshold: 0.35,
  ignoreLocation: true,
})
```

具体参数通过实际使用调整。

这一层负责：

> “我想找的记忆大概是什么？”

---

## Stage 2 — Associative Recall

对于 Stage 1 找到的 fragment：

```text
extract hashtags
       ↓
find fragments sharing those hashtags
```

例如：

```text
Fragment A

memsys stores its active recall index in memory.
#memsys #fusejs #architecture
```

产生：

```text
#memsys
#fusejs
#architecture
```

然后从 corpus 中寻找共享这些 anchors 的 fragments。

这一层负责：

> “想到这件事之后，我还会联想到什么？”

Association 完全由显式 anchors 决定。

---

# 6. Cloudflare Architecture

MVP：

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
      SQLite              Fuse.js
   persistent           in-memory
     memory            recall index
```

Cloudflare 当前推荐新的 stateless MCP server 使用 `createMcpHandler()` 和 Streamable HTTP。

MCP Worker 负责：

```text
protocol handling
authentication
memory-space routing
input validation
```

Memory Durable Object 负责：

```text
fragment persistence
Fuse index
anchor projection
recall
reinforcement
```

---

# 7. Why Durable Objects

一个 Memory Durable Object 可以对应一个独立 memory space：

```text
MemoryDO(user-a)
MemoryDO(user-b)
MemoryDO(agent-a)
```

每个 Durable Object 拥有：

```text
private SQLite database
+
ephemeral in-memory recall index
```

Cloudflare 推荐新的 Durable Object 使用 SQLite storage；DO storage 是对象私有、transactional、strongly consistent。

这种模型和 memsys 非常自然：

```text
one memory space
=
one Durable Object
```

---

# 8. Persistent vs Active Memory

SQLite 是 canonical memory：

```text
SQLite
└── fragments
```

Fuse.js 是 active recall structure：

```text
memory
└── Fuse index
```

DO 初始化时：

```text
SQLite
 ↓
load all fragments
 ↓
build Fuse index
```

DO warm 状态：

```text
recall
 ↓
Fuse.search()
```

因此大多数 recall 无需再次扫描数据库。

Cloudflare Durable Objects 支持把持久化状态加载到 instance memory，并在对象仍驻留内存期间复用；对象 eviction 后这些内存状态会消失，之后可以从 persistent storage 重建。

这形成了一个很自然的模型：

```text
SQLite
=
long-term memory

Fuse
=
active memory structure
```

---

# 9. Data Model

第一版只需要一张表：

```sql
CREATE TABLE fragments (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  recall_count INTEGER NOT NULL DEFAULT 0,
  last_recalled_at INTEGER
);
```

没有：

```text
tags
fragment_tags
links
edges
vectors
embeddings
```

`id` 属于 storage identity。

对外 API 使用：

```text
ref
```

Agent 通过 cue recall memory，通过 ref 操作已经确认的 memory。

---

# 10. In-memory Representation

DO warm 后可以维护：

```ts
class MemoryDO {
  fragments: Map<string, Fragment>
  fuse: Fuse<Fragment>
}
```

因为整个 corpus 已经在内存里，association 也可以直接在内存完成：

```text
recalled fragment
       ↓
extractAnchors()
       ↓
scan in-memory fragments
       ↓
associated fragments
```

第一版无需建立单独 tag index。

数据增长后，可以增加 ephemeral inverted index：

```ts
Map<Anchor, Set<FragmentRef>>
```

它依然属于 derived state：

```text
SQLite fragments
      ↓
rebuild
      ↓
anchor index
```

因此不会改变核心数据模型。

---

# 11. Operation Lifecycle

## Remember

```text
remember(fragment)
       ↓
SQLite INSERT
       ↓
in-memory fragments update
       ↓
Fuse index update
```

## Recall

```text
recall(cue)
       ↓
Fuse fuzzy search
       ↓
recalled fragment
       ↓
extract anchors
       ↓
resolve associations
       ↓
SQLite UPDATE reinforcement
       ↓
return recalled + associated
```

## Revise

```text
revise(ref, fragment)
       ↓
SQLite UPDATE
       ↓
update in-memory fragment
       ↓
refresh Fuse entry
```

Any anchor changes immediately affect future associations.

## Forget

```text
forget(ref)
       ↓
SQLite DELETE
       ↓
remove from memory
       ↓
remove from Fuse
```

All relationships disappear automatically because they were derived from the fragment.

---

# 12. Hashtag Grammar

Keep the syntax intentionally small.

Suggested grammar:

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

Parsing should normalize anchors:

```text
#Cloudflare
#cloudflare
```

→

```text
cloudflare
```

Exact normalized anchor equality defines association.

---

# 13. Reinforcement Model

memsys stores facts about recall behavior:

```text
recall_count
last_recalled_at
```

Example:

```text
remember()
   ↓
recall_count = 0

recall()
   ↓
recall_count = 1

recall()
   ↓
recall_count = 2
```

Associated fragments stay unchanged.

This allows future agents to reason about memory strength without requiring memsys itself to define a universal scoring formula.

Potential future derived concepts:

```text
frequently recalled
recently recalled
dormant
fading
```

These remain interpretations of stored history.

---

# 14. Scaling Model

The expected initial workload is a personal or agent-specific memory corpus consisting of many short fragments.

Cold start cost:

```text
N fragments
     ↓
N SQLite rows read
     ↓
build Fuse index
```

Warm recall:

```text
Fuse.search()
+
small SQLite reinforcement update
```

SQLite-backed DO storage currently bills reads by rows read; Workers Paid includes the first 25 billion rows read per month.

The more relevant practical limit is in-memory corpus size. Durable Objects receive a 128 MB memory allocation, shared at the isolate level when multiple DOs share an isolate.

Therefore the initial scaling strategy is:

```text
small/medium memory space
→ full in-memory Fuse index

large memory space
→ revisit indexing strategy
```

This optimization should be driven by observed corpus size.

---

# 15. MVP Scope

Version 0.1 should contain exactly four MCP tools:

```text
remember
recall
revise
forget
```

And exactly one persistent entity:

```text
fragment
```

Technology:

```text
Cloudflare Worker
Cloudflare Durable Objects
SQLite-backed DO storage
Fuse.js
Cloudflare Agents SDK / MCP
```

Core features:

- atomic text fragments
- hashtags embedded directly in fragment text
- fuzzy cue recall
- exact hashtag association
- automatic associated-memory expansion
- recall reinforcement
- durable persistence
- in-memory Fuse index reconstruction

---

# 16. Explicitly Deferred

These concepts stay outside the initial design:

```text
vector search
embeddings
semantic similarity
LLM-generated relationships
explicit graph edges
tag entities
folders
documents
pages
rich note hierarchy
automatic memory summarization
automatic forgetting
memory scoring formulas
```

They can be reconsidered only when actual usage demonstrates a concrete need.

---

# 17. Design Principles

### Fragments over documents

Memory should remain small and composable.

### Anchors over inferred relationships

Explicit hashtags define association.

### Cue over ID

Recall begins with something vaguely remembered.

### Derived structure over duplicated state

Tags and graph relationships come from fragment content.

### Behavior over scoring

memsys records recall history; interpretation can happen above the storage layer.

### Small API surface

```text
remember
recall
revise
forget
```

The API vocabulary should feel like interacting with memory rather than manipulating database records.

---

# 18. Definition

memsys can be described in one sentence:

> **memsys is a tiny associative memory system where agents remember fragments, recall them from fuzzy cues, and rediscover related memories through shared anchors.**

Or more conceptually:

> **Fragments are memories. Hashtags are anchors. Recall activates memory. Repetition reinforces it.**
