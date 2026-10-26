---
name: using-memsys
description: "Writes and recalls memories in memsys, one person's long-term memory shared by all their agents, through its MCP tools: remember, recall, revise, forget, list_tags. Use whenever a memsys MCP server is connected: before starting a task, when the user says something worth keeping, when a conversation produces a decision or lesson, when a write is refused, or when a recalled memory turns out wrong."
---

# Using memsys

memsys is one person's long-term memory, shared by every agent they use. What you write today, another agent recalls later, on another model, with no view of this conversation. memsys never summarizes, merges, decays, or forgets on its own: what you store comes back word for word, for years, until someone revises it.

## What to store

Memory holds the residual: what an agent with no history would get wrong. Before storing, ask one question: **at the moment this is needed, can the agent get it from somewhere else?**

| What it is | Examples | Store |
| --- | --- | --- |
| Said only here | what the user said, chose, or prefers; people and places in their life; decisions and why; what went wrong; corrections to you | the content |
| Kept in a durable source | code, commits, docs, benchmark results | the conclusion plus where it lives (path, URL, commit, directory); reread the source when you use it |
| The model already knows | general knowledge, how a common tool works | nothing |

Durable means reachable later: commits, docs, checked-in files. Chat logs, terminal output, and uncommitted files are not, so a result that dies with this conversation is worth storing.

Do not copy what you read from a queryable system such as a calendar, an inbox, or an issue tracker. If the user needs that state later, the fix is to connect that tool, not to cache it in memory. What the user tells you is always storable: "the dentist appointment is Thursday" from the user is a memory; the same entry read from their calendar is not.

Store as the conversation produces it, and always when the user says remember, note, or record. Before you finish a task, ask what another agent picking it up would need, and store that.

## How to write a fragment

- One independently updatable piece of knowledge per fragment, a few sentences at most. If two parts would go stale separately, they are two fragments.
- Make it stand alone. Name the people, projects, and things it is about; the reader has no conversation to look back at.
- Say whether the user said it or you inferred it. Only the user confirms their decisions and preferences; a guess written as a statement becomes a fact for every agent.
- The fragment records when it was written, not when things happened. Date the event itself: "switched to bun last month" is wrong a year later; "switched to bun in September 2026" is not.
- Use the words a future cue would use. Recall matches words, so a fragment about the user's editor should say "editor" and the editor's name.
- Add `#anchors` to link related fragments, such as `#family` or `#memsys`. Reuse an anchor already in use (`list_tags` shows them) instead of coining a near-duplicate like `#doc` beside `#docs`.

Good:

> The user said their sister Mei lives in Lisbon and visits every December. #family #mei

Pointer, not copy:

> memsys recall ranking lives in `worker/services/memory/recall.ts`; the contract is RFC 0002 in `docs/rfcs/`. #memsys #recall

Not a memory: how `git rebase` works, the contents of a file in the repo, today's calendar.

## When a write is refused

The owner sets a length limit, and memsys refuses a fragment over it. The refusal is a guardrail, not an obstacle: a fragment that long is almost always a copy of something (a commit, a diff, a benchmark table, a log) that belongs in its source, not in memory. Do not work around it.

1. **Ask first whether it should be stored at all.** If it is a copy of a durable source, or state read from another tool, store nothing or one short pointer. Most refusals end here.
2. **If it is worth keeping, keep the conclusion.** What was decided or learned, why, and where the detail lives. Drop the detail itself.
3. **Do not split a long text into several fragments to get it through.** Pieces that only make sense together are the same copy in parts, and each piece alone recalls badly. Split only when the text really holds several ideas, each of which stands alone.

A warning that a fragment is above the recommended length is the same question, asked gently.

Other failures are about the call, not the content: the parameters are `remember({ fragment })`, `recall({ context, cues })`, `revise({ ref, fragment })`, `forget({ ref })`. Read the error and fix the call.

## When and how to recall

- Recall before work that depends on the user or their world, once per topic, without being asked. Recall again when the topic changes, new evidence appears, or the user asks. Do not recall for what the model already knows or the repository answers.
- Give `context` (what you are working on) and short `cues`, one per angle, in one call. A cue is a few distinctive words, a phrase, or an `#anchor`. Alternative wordings share a cue; different facets get their own. For "plan a dinner for the user's parents": cues `parents food dislikes`, `dinner restaurant`, `#family`.
- `truncated: true` means some matches were left out: recall again with narrower cues or an anchor from `via`. When words miss, `list_tags` shows the anchor vocabulary in use; recall by an anchor.
- A memory that points at a source tells you where to look, not what is there now: reread the source.

## Keeping memory right

- When a recalled memory turns out wrong or outdated, `revise` it by ref, whoever wrote it: keep what still holds and say what changed. Do not `remember` a contradicting fragment beside it; recall would return both as true.
- When two memories disagree, go by what the user says now, then an explicit statement over an inference, then the later decision. A later `at` alone does not settle it. Revise the one that lost; if the conflict matters and you cannot settle it, show both and ask.
- `forget` a memory only when it is wrong beyond revising, a duplicate (keep one), or the user asked to forget it.
- Revise and forget keep history: the user can read every version in the web UI and restore one, so revising is safe. Only the user can delete a memory for good, from the web UI; when they want something gone, forget it and tell them that.
