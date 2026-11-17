# Development

How to run memsys on your machine, where its data lives, and what its tests cover. Deployment is in [Deployment](Deployment.md).

## Setup

Node.js 24 and pnpm 12 are pinned through Mise, and the tests run in the Workers runtime, so they see the same globals as production.

```sh
mise install
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm check       # types, tests, production build, lint, format check
pnpm dev         # apply local D1 migrations, then Vite frontend and local Worker
```

`pnpm dev` uses local D1 and Durable Object storage. `.dev.vars` is ignored and never deployed: it sets a development `BETTER_AUTH_SECRET` and `PUBLIC_URL`, and leaves `DEEPSEEK_API_KEY` for you to fill in. The memory model calls DeepSeek directly, so `recall` and `note` need that key; set `DEEPSEEK_BASE_URL` to send those calls to an OpenAI-compatible gateway instead. `pnpm invite` creates an invite code in the local database.

`pnpm typegen` reads `.dev.vars.example` to type the Worker's secrets, so add new secrets there too. `worker-configuration.d.ts` is generated and ignored. Keep secrets in ignored `.dev.vars` files.

## Dev sign-in and seed

The sign-in page on the dev server offers **Sign in as dev@memsys.test**. It signs the browser in as any address without a sign-in code or invite, creating the account the first time, and returns you to the page you were heading for. A new account starts with a fixed eight-fragment corpus (`worker/lib/dev-corpus.ts`) so the UI and the memory model have something to read.

With the dev server running, `pnpm db:seed` adds that corpus to `dev@memsys.test`'s memory again (memories already there are skipped); set `SEED_EMAIL` for another user who has signed in, and `SEED_URL` if the server is not on `http://localhost:5173`.

The dev sign-in skips the sign-in code and invite, so anyone who can reach the dev server can create an account on it; do not store sensitive data there. The printed codes and the dev sign-in exist only in dev builds: they sit behind `import.meta.env.DEV`, which `vite build` replaces with `false`, so a deployed bundle contains neither.

## Storage and migrations

Two stores, each with its own Drizzle schema and migrations:

- **D1** (`DB`) is the Worker's database: users, sessions, sign-in codes, rate-limit counters, API keys, and OAuth clients, consents, and signing keys. Schema in `worker/db/schema.ts`, migrations in `migrations/`, applied by `wrangler d1 migrations`.
- **One SQLite Durable Object per user** holds that user's memory. Schema in `core/db/schema.ts`, migrations in `core/migrations/`, bundled into the object.

A memory space id names each memory object. Every user has one default space whose id is their Better Auth user id (`defaultSpace` in `worker/memory.ts`), and every credential resolves to it, so REST and MCP reach the same memory. Clients cannot select another user's space.

Inside the object, `records` holds the fragment log, `personas` holds the agents the owner named, and `metadata` holds JSON documents by key: the owner's settings, and the snapshot cutoff under `logCursor`. SQLite is the only truth: migrations run before the object serves a request, and a fresh instance rebuilds its in-memory view of the log from it.

For future schema changes:

```sh
pnpm db:generate descriptive-migration-name          # D1
pnpm db:generate:core descriptive-migration-name     # memory core
```

Commit the generated SQL and snapshot, plus the memory object's migration bundle. `pnpm dev` applies D1 migrations locally; `pnpm deploy` applies them remotely before deploying. Memory object migrations run when each object starts. Wrangler's `v1` migration registers the SQLite object class; it is separate from SQL schema migrations.

## Tests

Tests use real email sign-in, sessions, API keys, OAuth sign-in, D1, SQLite objects, object eviction, and MCP protocol requests. The Resend request and the memory model are replaced: sign-in reads its code from the fake Resend response, and the model runs against a scripted provider that keeps the real provider and model ids. No Cloudflare account or model key is needed.

Tests are grouped by behavior in `tests/`: authentication and HTTP safety, REST and MCP contracts, the model's prompt, caps, and failures, edits and length limits, persistence, pagination, settings, and the development seed. A snapshot file under `tests/artifacts/` covers one full scripted recall and note run. `helpers.ts` contains only shared request and authentication setup. Keep assertions on returned data, rejected requests, identity isolation, and persisted results. Test matching and pagination edge cases with pure functions; test transport and storage behavior through their public interfaces. Do not lock tests to prose, generated schema formatting, cursor encoding, or SQL layout.

`pnpm build` builds `dist/client` and `dist/memsys` locally; it does not deploy or run migrations.
