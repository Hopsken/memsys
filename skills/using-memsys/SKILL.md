---
name: using-memsys
description: "Writes and recalls memories in memsys, one person's long-term memory shared by all their agents. Use whenever a memsys MCP server is connected, including when the user says, chooses, or prefers something, when a conversation produces a decision or a lesson, before work that depends on the user, when your host saves to its own memory, when a write is refused or warned, and when a recalled memory is wrong or outdated."
---

# Using memsys

What you write, another agent recalls later, on another model, with no view of this conversation. memsys never summarizes, merges, decays, or forgets on its own. What you store comes back word for word, until someone revises it.

## What to store

Before storing, ask one question. At the moment a future agent needs this, can that agent get it from somewhere else?

| What it is | Examples | Store |
| --- | --- | --- |
| Said only here | what the user said, chose, or prefers; people and places in their life; decisions and why; what went wrong; corrections to you | the content |
| Kept in a durable source | code, commits, docs, benchmark results | the conclusion, and where it lives, such as a path, URL, commit, or directory. Reread the source when you use it |
| The model already knows | general knowledge, how a common tool works | nothing |

Durable means a future agent can open it. Commits, docs, and checked-in files are durable. Chat logs, terminal output, and uncommitted files are not. Store a result that dies with this conversation.

Do not copy what you read from a queryable system such as a calendar, an inbox, or an issue tracker. Connect that tool when the user needs that state. What the user tells you is storable. "The dentist appointment is on 29 October 2026" from the user is a memory. The same entry read from their calendar is not.

Store a memory as the conversation produces it, and whenever the user says remember, note, or record. If your host has a memory of its own, a write you make there stays inside that product. In the same turn, store in memsys the part these rules keep. When your host changes memory in the background, without you, you cannot mirror it. Do not claim that you did. Before you finish a task, store what another agent would need to pick the task up.

## How to write a fragment

- Write one independently updatable fact per fragment, a few sentences at most. When two parts would go stale separately, write two fragments.
- Name the people, projects, and things. The reader has no conversation to look back at.
- Say whether the user said it or you inferred it. Only the user confirms their decisions and preferences. A guess written as a fact becomes a fact for every agent.
- Date the event in the text. The fragment records when it was written. "Switched to bun in September 2026" stays true. "Switched to bun last month" does not.
- Use the words a future cue would use. Recall matches words. A fragment about the user's editor says "editor" and the editor's name.
- Add `#anchors` to link related fragments, such as `#family` or `#memsys`. `list_tags` shows the anchors in use. Reuse one. Do not coin a near-duplicate such as `#doc` beside `#docs`.

Write what the user said as its own fragment.

> The user said their sister Mei lives in Lisbon and visits every December. #family #mei

Point at a durable source instead of copying it.

> The user switched the api repo to bun in September 2026. The notes are in `docs/tools.md`. #tools #bun

Leave general knowledge, the contents of a file, and a calendar entry you read from the calendar out of memory.

## When a write is refused

The owner sets a length limit. memsys stores nothing when a fragment is over it. Treat that fragment as a copy of a commit, a diff, a table, or a log.

1. If it is a copy of a durable source, or state you read from another tool, store nothing, or one short pointer.
2. If it is worth keeping, store the conclusion. What was decided or learned, why, and where the detail lives.
3. Do not split one text into several fragments to get it through. Pieces that only make sense together are the same copy in parts. Split only when the text holds several facts, and each fact stands alone.

A warning that a fragment is above the recommended length asks the same question. The write did succeed.

Any other error is about the call. Read the error and fix the arguments. Leave the fragment alone.

## When and how to recall

Recall before work that depends on the user or their world, once per topic, without being asked. Recall again when the topic changes, when new evidence appears, or when the user asks. Do not recall for what the model already knows, or for what the repository answers.

For a dinner for the user's parents, make one call. Set `context` to that plan. Use the cues `parents food dislikes`, `dinner restaurant`, and `#family`.

A memory that points at a source tells you where to look. Reread the source before you rely on it.

## Keeping memory right

`by` is who last wrote the text down. `user` is the person. Any other name is one of their agents. `by` says who wrote it down, not who said the fact. Read the fragment for that. A missing `by` is not the user. Do not invent a writer.

When a recalled memory is wrong or outdated, `revise` it by `ref`, whoever wrote it. Keep what still holds, and say what changed. Do not `remember` a contradicting fragment beside it. Recall would return both as true.

When two memories disagree, prefer what the user says now, then an explicit statement over an inference, then the later decision. A later `at` does not settle the conflict by itself. Revise the memory that lost. When the conflict matters and you cannot settle it, show both and ask.

`revise` and `forget` keep history. The user can read every version in the web UI and restore one. Only the user can delete a memory for good, from the web UI. When they want something gone, forget it, and tell them only they can delete it for good.
