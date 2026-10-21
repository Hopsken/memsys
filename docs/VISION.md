## Purpose

This is an overview of what memsys is for, zoomed out enough that it survives while the exact tools, ranking rules, and plugins shift over time.

### Charter

memsys is a durable memory for AI agents: a user's history should outlive any single generation of model, and any single agent.

### Tenets

Tenets guide how decisions are made. Ideally we honor all of them all the time. When two conflict, the one earlier in the list wins.

1. **Durable.** The memory layer outlives the model. It stores only model-independent content — natural-language fragments and explicit, human-readable tags. Fragments are the single source of truth.
2. **Faithful.** What is stored is what was written. The system never summarizes, merges, reinforces, decays, or forgets on its own.
3. **Composable.** The tool contract is small, orthogonal, and stable, in the way Bash is.
4. **Inspectable.** A person can read their entire memory, and can see why something was recalled (which anchors it shared). Nothing is hidden behind a model's opinion.
5. **Accessible.** Any model with basic tool use can use memsys for everyday needs. Stronger models get more out of the same primitives; we do not chase parity for weak models, nor compatibility with every model.

## Use Cases

### A person with a long-running personal assistant

The primary user. They want one memory that follows them for years, across model upgrades and across every agent they use: a chat assistant, a coding agent, a voice assistant, whatever comes next. Over time they tell those agents who the people in their life are, what they like, how their days run, what went wrong last time — and expect not to repeat themselves when the model is upgraded or they switch agents. They care most that memsys is **Durable** and **Faithful**: the memory survives the model swap, and it says what they said.

memsys is the one memory all of those agents share. A person tells ChatGPT their favorite fruit is watermelon. Weeks later they ask Claude to plan a dinner, and Claude suggests watermelon for dessert without being told to check. Two things make that work. What one agent writes, every agent connected to the same memory can recall: the fragment is plain text, so no agent needs to understand another. And the agent knows to recall on its own. That starts with memsys's own server instructions and tool descriptions, which every connected agent reads; the person's AGENTS.md or custom instructions can add to them. memsys does not reach into the conversation (see [Boundaries](#boundaries)).

Coding agents are one important surface: people who use them daily store a lot about code. They are still one of the agents a person uses, not the definition of the product. The memory is about the whole person.

The success measure is theirs: _how often do I have to repeat myself?_ Fewer repetitions means it is working. Noise is easy to feel; omissions are not — catching yourself re-explaining something is the signal of a miss.

### Authors of AGENTS.md, custom instructions, and skills

They compose memsys with the rest of the harness: "read `#must-read` before starting" in AGENTS.md or an assistant's custom instructions, a skill for how to write good fragments. They care that memsys is **Composable** — that push, scoping, and workflow can be expressed as conventions over stable primitives rather than as new endpoints.

### Cheap models on routine tasks

Most everyday work does not need a frontier model. A cheaper model should get correct, low-noise memory from a small tool surface. They care that memsys is **Accessible** and **Inspectable**: few tools, plain output, no surprises.

## What Memory Holds

Memory stores the **residual**: what a model with no history would get wrong.

- The model knows lactose intolerance is common → not stored. It does not know you are lactose intolerant → stored.
- The model knows how to plan a trip to Kyoto → not stored. It does not know you went last spring and found the temples too crowded → stored.
- The model knows pnpm and bun both work → not stored. It does not know you switched to bun last month → stored.

Three kinds of payload in practice:

| Kind | Example | Shape |
| --- | --- | --- |
| Preferences | favorite fruit is watermelon; aisle seat; no meetings before 10 | few, very stable, apply almost always, nobody thinks to look them up |
| Facts about the person's world | sister Mei lives in Lisbon; the dentist is Dr. Okafor | moderate, stable, scoped by person, place, or project |
| Episodic lessons | the hotel the assistant booked in Porto was too noisy | many, ever-growing, triggered by situation rather than keyword |

Whether a fragment can be recalled is decided as much when it is written as when it is queried: recall works on the overlap between cue and encoding. The write path deserves the same design attention as the read path.

## Boundaries

Three things compose; none replaces another.

- **AGENTS.md** and custom instructions — always-injected strong context. Present every turn, never retrieved.
- **Skills** — how to do things. How a tool is used, how it is used well.
- **Memory** — durable facts and experience. Retrieved on demand.

Push is a convention, not a mechanism. memsys's server instructions and tool descriptions tell every connected agent when to recall, such as before it plans or suggests something, so it looks without being asked. A person can add to that: one line in AGENTS.md or custom instructions pointing at `#must-read` is a "how to work with me" document. Data lives in memory, policy lives in the instructions, the substrate does not move.

## The System

### Layers

- **Durable store.** Fragments. Tags and every index are derived caches that can be deleted and rebuilt.
- **Core.** Four tools: `remember`, `revise`, `forget`, `recall`. The minimal complete set — write, change, forget, bring back. Remove any one and it stops being a memory system.
- **Plugins.** Everything else. Policy plugins extend how `recall` ranks and filters and how writes are checked; tool plugins add capabilities. Plugins read fragments; they never modify them except through the core write tools.
- **Per-instance configuration.** Which plugins are on and how they are tuned belongs to the user's instance, like temperature belongs to a harness. The agent cannot see or change it.

The test for placing something: _if we remove it, is this still a memory system?_ Yes → plugin. No → core.

### Stability Promise

The core contract — four tools, their inputs, the meaning of their outputs — is meant to hold for years. New capability arrives as additive fields or as plugins that can be switched off. Configuration is not part of the contract: two instances with different plugins behave differently, but the same agent code runs against both.

## Not in the Core

The following are not part of the core and are not on by default. They are not ruled out: any of them may arrive as a plugin, provided it leaves the data foundation untouched.

- Vector indices, embeddings
- Summarization, hierarchical memory, merging fragments into "higher-level knowledge"
- Reinforcement, access history, decay
- Model judgment on the read or write path

The condition is the same for all of them: fragments remain the single source of truth, and whatever the plugin computes is a derived cache that can be deleted and rebuilt. An embedding index is fine if it can be thrown away; it is not fine if the fragments stop being sufficient without it. A summarizer that proposes a merged fragment for the agent to `remember` is fine; one that silently rewrites fragments is not.
