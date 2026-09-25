# memsys

A tiny associative memory system for agents. Fragments are plain text; shared hashtags associate them.

Store one durable idea per fragment. Recall starts from a textual cue and follows explicit anchors, not inferred relationships. Fragments are the source of truth; tags and associations are derived. Vector search, automatic summaries, and memory reinforcement are outside the current scope.

To connect an agent, sign in to the web UI, create an MCP token under **MCP tokens**, and add the server with that token (see [Sign-in and MCP tokens](#sign-in-and-mcp-tokens)).

[Project Vision](docs/VISION.md) [Architecture](docs/Architecture.md)

## Web UI

Sign in at `/login` with a one-time code sent to your email. Open `/` to browse your fragments, `/plugins` to configure plugins for your memory, and `/tokens` to manage MCP tokens. Fragments are created, revised, and deleted through your connected agent.

To move memory to another instance, use **Export** on `/` to download every fragment as JSON (`GET /api/export`), then **Import** that file on the other instance (`POST /api/import`, up to 5 MB). Import keeps each fragment's ref, text, and timestamps. It only adds: a fragment whose ref or text is already in memory is skipped, and a ref that holds different text is reported and left unchanged. Only `fragment` is required per item, so files from other systems can be converted into the same shape. Import runs core validation but not plugin write checks, and stores nothing if any item is invalid. Neither operation is available over MCP.

The app uses Vite, React, Tailwind CSS 4, and shadcn/ui in `client/`. Hono, authentication, MCP, and the Durable Object live in `worker/`. The Cloudflare Vite plugin serves both from one origin. The browser keeps its session in an HTTP-only cookie and sends same-origin requests.

## How it works

Agents connect over MCP at `/mcp` (stateless Streamable HTTP) with an MCP token. The core tools are `remember`, `recall`, `revise`, and `forget`; plugins may add more, such as the default `list_tags`. The web UI uses the same operations through a JSON API under `/api/`. Input schemas live in `worker/memory.ts`.

- **Recall** matches fragments that contain every word of the cue, in any order; English words are stemmed, and a cue of three or more words may miss one. Fragments containing the whole cue as a phrase come first, the rest rank by words matched and BM25. Recall then follows one hop through shared `#anchors`. Associated results list those anchors in `via`. Association splits anchors on `-` and stems English words; `/` namespaces match exactly.
- **Length** is counted in grapheme clusters. Core rejects anything over 1000; the [size-limit plugin](docs/plugins/size-limit.md) sets the everyday limits.
- **Plugins** live in `plugins/` and reach the worker only through `contract/`. Each one is documented in [docs/plugins](docs/plugins/README.md); [Architecture](docs/Architecture.md) covers the hooks, failure rules, and per-instance configuration.

## Storage

Two stores, each with its own Drizzle schema and migrations:

- **D1** (`DB`) is the Worker's database: users, sessions, sign-in codes, rate-limit counters, and MCP tokens. Schema in `worker/db/schema/`, one file per area (Better Auth's tables in `auth.ts`), migrations in `migrations/`, applied by `wrangler d1 migrations`.
- **One SQLite Durable Object per user** holds that user's memory. Schema in `worker/memory-do/db/schema.ts`, migrations in `worker/memory-do/migrations/`, bundled into the object.

A memory space id names each memory object. For now every user has one default space whose id is their Better Auth user id (`defaultSpace` in `worker/auth.ts`). A session and an MCP token both resolve to it, so REST and MCP reach the same object. Clients cannot select another user's memory space.

In the memory object, `fragments` holds the memory; `plugin_config` holds per-instance plugin settings. Drizzle migrations run inside `blockConcurrencyWhile` before the object accepts requests. The object then loads all fragments into a map. Writes update SQLite before the map. Object eviction removes only the map; the next instance rebuilds it from SQLite. Anchor and search results are disposable projections.

For future schema changes:

```sh
pnpm db:generate descriptive-migration-name          # D1
pnpm db:generate:memory descriptive-migration-name   # memory object
```

Commit the generated SQL and snapshot, plus the memory object's migration bundle. `pnpm dev` applies D1 migrations locally; `pnpm deploy` applies them remotely before deploying. Memory object migrations run when each object starts. Wrangler's `v1` migration registers the SQLite object class; it is separate from SQL schema migrations.

## Sign-in and MCP tokens

[Better Auth](https://www.better-auth.com/) runs in the Worker under `/api/auth` and reads D1 directly. There are two credentials, and each reaches only its own side:

| Credential | Held by | Reaches |
| --- | --- | --- |
| Session cookie, from an emailed one-time code | The browser | The web UI and `/api/*`: memory, plugin settings, token management |
| MCP token (`memsys_…`), a Better Auth API key | An agent | `/mcp` only |

A token never stands in for a session, so an agent holding one cannot change plugin settings or create tokens, and a session cookie does not open `/mcp`. Tokens are stored hashed; the web UI shows each one once, when it is created. Revoking a token takes effect on the next request.

Sign-in codes go out through [Resend](https://resend.com/) and only to addresses in `AUTH_ALLOWED_EMAILS` (comma-separated; `@example.com` allows a domain). Other addresses are refused with an error, get no email, and cannot create an account. Sign-in routes are rate limited per client address, with counters in D1.

Connect an agent with its token as a bearer header, for example in Claude Code:

```sh
claude mcp add --transport http memsys https://<hostname>/mcp \
  --header "Authorization: Bearer memsys_…"
```

MCP clients that only support OAuth, such as ChatGPT connectors, cannot connect yet.

Before the first deployment:

1. After the first deploy, add a custom domain to the Worker in the Cloudflare dashboard (**Settings → Domains & Routes**). `wrangler.jsonc` names no domain, and deploys leave the one you add in place.
2. Create the database with `pnpm exec wrangler d1 create memsys` and add its `database_id` to `wrangler.jsonc`.
3. Verify a sending domain in Resend.
4. Set the Worker's variables in the Cloudflare dashboard (**Workers & Pages → memsys → Settings → Variables and Secrets**); `.dev.vars.example` lists them all. `PUBLIC_URL` is that custom domain's origin (e.g. `https://memsys.example.com`), and `EMAIL_FROM` an address on the Resend domain. Store `BETTER_AUTH_SECRET` (at least 32 random characters, e.g. `openssl rand -base64 32`), `RESEND_API_KEY`, and `AUTH_ALLOWED_EMAILS` as secrets. `wrangler.jsonc` sets `keep_vars`, so deploys leave them alone; nothing instance-specific lives in the repository.
5. Remove any Cloudflare Access application in front of the hostname. The Worker authenticates every request itself.
6. Run `pnpm check`, then deploy when approved with `pnpm deploy`.
7. Sign in, create a token, and connect an MCP client. Check every tool, and that `/api/*` rejects the token.

`workers.dev` and preview URLs are disabled.

### Keeping memory from the Access deployment

Earlier versions named memory objects after the Cloudflare Access identity, so a new user starts with empty memory. To keep it, **Export** on `/` before deploying this version, then **Import** the file after signing in. That moves fragments only; set plugins again on `/plugins`.

## Development and checks

Node.js 24 and pnpm 11 are pinned through Mise. Hono handles routing; Zod schemas are shared by REST, MCP, and the object. Drizzle handles SQLite. Vitest tests run in the Workers runtime.

```sh
mise install
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm check       # Types, tests, production build, lint, format check
pnpm dev         # Apply local D1 migrations, then Vite frontend and local Worker
pnpm eval        # Score recall on eval/dataset.ts; JEV=1 adds Jev (bills Workers AI)
```

`pnpm dev` uses local D1 and Durable Object storage. Copy `.dev.vars.example` to the ignored `.dev.vars`: it sets a development `BETTER_AUTH_SECRET` and `PUBLIC_URL`; put your address in `AUTH_ALLOWED_EMAILS`. With `RESEND_API_KEY` or `EMAIL_FROM` empty, a dev build prints sign-in codes in the dev server log instead of emailing them; a production build refuses to sign in without both. Open `/` on the development server and sign in.

With the dev server running and after signing in once, `SEED_EMAIL=you@example.com pnpm db:seed` replaces that user's memory with a fixed eight-fragment corpus (`worker/dev/corpus.ts`) so the UI and recall have something to show. Set `SEED_URL` if the server is not on `http://localhost:5173`. The seed route skips sign-in, so anyone with access to the dev server can use it; do not store sensitive data there.

The printed codes and everything under `worker/dev/` exist only in dev builds: they sit behind `import.meta.env.DEV`, which `vite build` replaces with `false`, so the deployed bundle contains neither.

`.dev.vars` is not deployed. `pnpm typegen` reads `.dev.vars.example` to type the Worker's secrets, so add new secrets there too.

Tests use real email sign-in, sessions, MCP tokens, D1, SQLite objects, object eviction, and MCP protocol requests. Only the Resend request is mocked; the test reads the code from it. No Cloudflare account is needed.

Tests are grouped by behavior in `tests/`: authentication and HTTP safety, REST and MCP contracts, edits and length limits, persistence, recall, pagination, plugins and their configuration, and the development seed. `helpers.ts` contains only shared request and authentication setup. Keep assertions on returned data, rejected requests, identity isolation, and persisted results. Test matching and pagination edge cases with pure functions; test transport and storage behavior through their public interfaces. Do not lock tests to prose, generated schema formatting, cursor encoding, or SQL layout.

`worker-configuration.d.ts` is generated and ignored. Keep secrets in ignored `.dev.vars` files. `pnpm build` builds `dist/client` and `dist/memsys` locally; it does not deploy or run migrations. `pnpm deploy` builds, applies D1 migrations remotely, and deploys. Check a live email sign-in after the first deployment.
