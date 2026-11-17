# memsys

A durable memory for AI agents, in plain language. One person's memory serves every agent they connect.

Agents use two tools. `recall` asks what memory holds for the task and answers in prose. `note` hands over conversation context, and memory decides what to keep, revise, or forget. The person reads, edits, imports, and audits the same memory in the web UI.

## Connect an agent

Add `https://<hostname>/mcp` as an MCP server and sign in when it asks:

```sh
claude mcp add --transport http memsys https://<hostname>/mcp
```

Agents that cannot sign in use an API key from **Settings → MCP** instead:

```sh
claude mcp add --transport http memsys https://<hostname>/mcp \
  --header "Authorization: Bearer memsys_…"
```

`memory:read` grants `recall` and `memory:write` grants `note`; a connection needs at least one.

## Run it locally

Node.js 24 and pnpm 12, pinned through Mise.

```sh
mise install
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm dev      # apply local D1 migrations, then serve http://localhost:5173
pnpm check    # types, tests, build, lint, format
```

Fill in `DEEPSEEK_API_KEY` in `.dev.vars` for `recall` and `note`. While `RESEND_API_KEY` and `EMAIL_FROM` are empty, sign-in codes print in the dev server log, and the sign-in page offers **Sign in as dev@memsys.test**. [Development](docs/Development.md) covers the dev routes, the seed corpus, migrations, and tests.

## Deploy

memsys runs on Cloudflare Workers with D1 and one SQLite Durable Object per person. `pnpm deploy` builds, applies D1 migrations remotely, and deploys.

The first deploy also needs a D1 database, a verified Resend domain, a custom domain, and the Worker's variables and secrets. [Deployment](docs/Deployment.md) lists them, along with invite codes and the access model.

## Layout

- `client/` — the web UI: Vite, React, Tailwind CSS 4, and shadcn/ui in Feature-Sliced Design layers.
- `worker/` — Hono routes, Better Auth, MCP, and the memory model.
- `core/` — the memory core: a SQLite Durable Object that stores and replays the fragment log.
- `lib/` — rules both sides compute the same way.
- `docs/` — design documents and RFCs.

## Docs

- [Vision](docs/VISION.md) — why memsys exists and what it will not become.
- [Architecture](docs/Architecture.md) — where a piece of behavior lives.
- [Portability](docs/Portability.md) — export a memory, or import one from another instance.
- [Deployment](docs/Deployment.md) — a first deploy, secrets, invitations, and access.
- [Development](docs/Development.md) — local setup, dev sign-in, migrations, and tests.
- [RFCs](docs/rfcs/) — design decisions with their alternatives.
