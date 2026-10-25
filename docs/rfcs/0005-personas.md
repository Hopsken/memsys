# RFC 0005: Personas

- Status: Proposed
- Created: 2026-10-25
- Discussion: [Amp thread](https://ampcode.com/threads/T-01a17167-e1dc-7236-a090-9abf64e68b29)

## Summary

A **persona** is an agent identity that the user records in a memory space. The user can assign a connection to a persona. Writes from that connection then record `by: "persona:<id>"`. Writes from a connection with no persona record `by: "agent:<name>"`, as they do today.

Personas live in the memory core beside the log, so the memory space alone explains every `persona:<id>` in the log. The user can archive a persona but never delete it.

With personas, the web UI shows the current name of the agent that made each change, and the user can list every change that one agent made.

## Why

memsys exists so that all of a person's agents share one memory. To share memory well, memsys must know which agent wrote each record. Today it knows only which connection wrote it.

Each agent's identity lives in its own system, such as a Grok bot, a Muse assistant, or the configuration of a coding agent. memsys sees only the connection that the agent signs in with, and a connection is a credential. The user creates and drops connections when they reconnect, change machines, or rotate keys. One agent uses many connections over its life, so a connection cannot stand in for the agent.

Today `by` is `agent:` and the name of the OAuth client or API key at the time of the write. That causes four problems:

- When the user connects the same agent again, the name can change, and the agent's history splits in two.
- An OAuth client reports its own name, so any client can call itself "ChatGPT".
- Two connections with the same name cannot be told apart.
- A name in the log never changes, so the user cannot rename an agent.

memsys needs an identity that the user records, that outlives every connection, and that the log can refer to.

## Goals

1. The web UI shows the correct, current name of the agent that made each change.
2. The user can list every change that one agent made.

Both goals must hold before agents can see authorship in `recall`. That change alters the MCP output contract and needs its own discussion, so this RFC does not include it.

## Terms

- A **persona** is an agent identity in a memory space. It has an id, a name, and an archived flag. A persona exists without any connection, for example after an import or after the agent stops.
- A **connection** is a credential that lets an agent call `/mcp`. It is either an OAuth consent for one client or an API key. A connection can belong to one persona.
- The **author** of a log record is the value of its `by` field.

## Decisions

### 1. A persona is the user's record of an outside agent

The user creates and names a persona. The agent does not. memsys does not check the identity with the agent's own system.

At write time, memsys must decide which persona wrote. Everything in a request comes from the agent, and the agent can claim any identity. The credential is the one thing in the request that the agent cannot fake. So memsys trusts a persona on a write only because the user assigned the credential to it.

An agent cannot see, create, or change personas. Persona management needs the user's session, as settings and credential management do. [Architecture invariant 4](../Architecture.md#invariants) states that rule.

### 2. A connection can belong to a persona

A connection belongs to zero or one persona. A persona has zero or more connections.

| Writer                       | `by`           |
| ---------------------------- | -------------- |
| A connection with a persona  | `persona:<id>` |
| A connection with no persona | `agent:<name>` |
| The user, in the web UI      | `user`         |

A new connection has no persona. The user can pick one when they connect an app, or at any time later. Many connections never need a persona. Personas are for the agents whose identity matters to the user.

The agent cannot write before the user's choice of persona is saved. If the save fails, the connection has no persona, which is the default.

An OAuth connection is one client, because the consent is per client. Every install that uses the same client id belongs to the same persona. To give a second install its own persona, the user connects it with an API key.

### 3. The author is fixed at write time

A record keeps the author that was correct when the record was written:

- A change to a connection's persona affects only later writes.
- Records from a connection with no persona keep `agent:<name>`. memsys does not move them to a persona, even when the names match, because two unrelated connections can have the same name.
- When a connection with a persona revises a fragment, the new version belongs to the persona. Over time, the current version of each fragment that an agent maintains moves to its persona with no extra step.

### 4. A persona is never deleted

The user can archive and unarchive a persona. Nobody can delete it, and its id is never reused. With these two rules, every `persona:<id>` in the log refers to the same identity forever.

An archived persona gets no new writes. Archiving removes the persona from the list that the user picks from, and removes every connection from it. Those connections then write `agent:<name>`. Before the user archives a persona, the web UI says how many connections this changes.

The Worker removes the connections first and archives the persona second. If the second step fails, the persona is still active and has no connections, and the user can try again. The reverse order could leave an archived persona that still gets writes.

Unarchiving does not give the connections back. memsys does not remember which connections a persona had, and the user assigns them again.

Names need not be unique. The web UI refers to a persona by its id, so two personas with the same name stay apart.

### 5. Personas live in the memory core

The log refers to personas by id, so the core keeps personas with the log. [RFC 0004](0004-memory-core.md), decision 1.3, puts the meaning of the data in the core. The core must also check a persona id in the same transaction as the write, so personas are a typed table, not a metadata document.

The table is mutable. The log needs only the two rules in decision 4, and a history of names would add nothing to them.

The core contract changes in three places:

- `authorSchema` accepts `persona:<id>`.
- A write with `by: "persona:<id>"` fails with `not-found` when no persona has that id. It does not fall back to `agent:<name>`, because a silent fallback would hide broken data.
- The activity read can return only the records of one author.

Which persona a connection belongs to is the Worker's business. The Worker keeps it in D1, beside the credentials.

### 6. Export and import carry personas

Every export includes all personas, before the fragment records. It does not include which persona a connection belongs to, because credentials do not move between instances.

Import adds a persona whose id the memory space does not have, and skips one whose id it has. An imported memory therefore keeps its history under the same personas. The user then assigns the reconnected agents to them, and their history continues.

A record that refers to a persona that neither the file nor the memory space has still imports. The web UI shows it as written by an unknown agent.

### 7. The web UI shows each author by its current name

| `by`                     | Shown as                    |
| ------------------------ | --------------------------- |
| `user`                   | "by you"                    |
| `persona:<id>`           | the persona's current name  |
| `persona:<id>`, archived | the name, marked "archived" |
| `persona:<id>`, unknown  | "by an unknown agent"       |
| `agent:<name>`           | the name, as today          |

**Activity** has a filter for one author.

## Not in this RFC

- **Authorship in `recall`.** It changes the MCP output contract and needs its own discussion.
- **Scopes per persona.** Scopes stay on the connection.
- **Memory per persona.** All agents share one memory, as [VISION](../VISION.md) says. Tags can separate content when the user wants that.
- **One credential for many agents.** The link between connections and personas would become many-to-many.
- **Merging personas.** Nothing needs it now. It can be added later without a change to stored data.
- **Moving old `agent:<name>` records to a persona.** Decision 3 explains why.
- **Verifying a persona with the agent's own system.**

## Alternatives considered

### Give every connection a persona, created automatically

A persona named after the client's reported name is the same untrusted name that this RFC replaces, and the persona list fills with product names. With optional personas, a user who never creates one sees the same history as today.

### Add a `connection:<id>` author for connections with no persona

It would tell apart two such connections with the same name. It adds a fourth kind of author, and memsys would have to keep a record of every connection after the user disconnects it. `agent:<name>` is enough, because decision 3 does not move old records.

### Move old records to a persona by name

An alias from `agent:<name>` to a persona would also take the records of every other connection with that name. That can be wrong, and the user cannot see that it is wrong.

### Keep personas in D1

Then the log refers to ids that the memory space cannot explain, and an export contains ids with no meaning. An export carries only the memory space, so personas live in it.

### Write persona changes into the fragment log

Every reader of the log expects fragment records: replay, the indexes, history, activity, purge, and import. Each would have to skip persona records, and purge must never remove one. A persona is not a fragment.

### Let the agent declare its own identity

An agent can claim any identity, and a prompt injection can change the claim. The user is the only party that memsys can trust to say which agent a connection belongs to.

### Give an OAuth connection a persona per grant, not per client

Two installs that share a client id could then belong to different personas. The access token would need a stable grant id, and connection management would have to work per grant. An API key covers the same case today.

## Migration

Existing connections have no persona, and existing records keep their `by`. The migration rewrites nothing. A build without persona support rejects an import file that contains personas. One deployment exists today, so the risk is small.

## Testing

End-to-end tests through `/mcp` and `/api/` check that none of these failures happen:

- A write records the wrong kind of author for its connection.
- A change to a connection's persona changes the author of earlier records.
- A rename does not show on a persona's earlier records.
- The core stores a write with an unknown persona id.
- After the user archives a persona, a write from one of its former connections records the persona instead of `agent:<name>`, or fails.
- The agent can write before its persona is saved.
- An export and import loses a persona or the link between records and personas.
- The Activity filter for one author misses records or includes another author's records.

The final test exports a memory space with personas and imports it into a new space. It assigns a new API key to an imported persona, writes with that key, and checks that Activity shows the old and the new records under one persona. The test keeps the export file and the Activity response as its artifact.
