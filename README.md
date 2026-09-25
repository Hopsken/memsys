# memsys

A tiny associative memory system for agents. Fragments are plain text; shared hashtags associate them.

Store one durable idea per fragment. Recall starts from a textual cue and follows explicit anchors, not inferred relationships. Fragments are the source of truth; tags and associations are derived. Vector search, automatic summaries, and memory reinforcement are outside the current scope.

To connect the deployed server, follow [Use memsys in ChatGPT](docs/chatgpt.md).

[Project Vision](docs/VISION.md) [Architecture](docs/Architecture.md)

## Web UI

Open `/` to browse your fragments and `/plugins` to configure plugins for your memory. Fragments are created, revised, and deleted through your connected agent.

To move memory to another instance, use **Export** on `/` to download every fragment as JSON (`GET /api/export`), then **Import** that file on the other instance (`POST /api/import`, up to 5 MB). Import keeps each fragment's ref, text, and timestamps. It only adds: a fragment whose ref or text is already in memory is skipped, and a ref that holds different text is reported and left unchanged. Only `fragment` is required per item, so files from other systems can be converted into the same shape. Import runs core validation but not plugin write checks, and stores nothing if any item is invalid. Neither operation is available over MCP.

The app uses Vite, React, Tailwind CSS 4, and shadcn/ui in `client/`. Hono, authentication, MCP, and the Durable Object live in `worker/`. The Cloudflare Vite plugin serves both from one origin. Cloudflare Access protects the whole hostname; the browser sends same-origin requests without storing tokens.

## How it works

Agents connect over MCP at `/mcp` (stateless Streamable HTTP). The core tools are `remember`, `recall`, `revise`, and `forget`; plugins may add more, such as the default `list_tags`. The web UI uses the same operations through a JSON API under `/api/`. Input schemas live in `worker/memory.ts`.

- **Recall** matches fragments that contain every word of the cue, in any order; English words are stemmed, and a cue of three or more words may miss one. Fragments containing the whole cue as a phrase come first, the rest rank by words matched and BM25. Recall then follows one hop through shared `#anchors`. Associated results list those anchors in `via`. Association splits anchors on `-` and stems English words; `/` namespaces match exactly.
- **Length** is counted in grapheme clusters. Core rejects anything over 1000; the [size-limit plugin](docs/plugins/size-limit.md) sets the everyday limits.
- **Plugins** live in `plugins/` and reach the worker only through `contract/`. Each one is documented in [docs/plugins](docs/plugins/README.md); [Architecture](docs/Architecture.md) covers the hooks, failure rules, and per-instance configuration.

## Storage

One SQLite Durable Object holds each user's memory. Its name is `JSON.stringify([verifiedIssuer, verifiedSubject])`. REST and MCP use the same object. Clients cannot select another user's memory space.

`fragments` holds the memory; `plugin_config` holds per-instance plugin settings. Drizzle migrations run inside `blockConcurrencyWhile` before the object accepts requests. The object then loads all fragments into a map. Writes update SQLite before the map. Object eviction removes only the map; the next instance rebuilds it from SQLite. Anchor and search results are disposable projections.

For future schema changes:

```sh
pnpm db:generate:memory descriptive-migration-name
```

Commit the generated SQL, snapshot, and migration bundle. Wrangler's `v1` migration registers the SQLite object class; it is separate from SQL schema migrations.

## Cloudflare Access and Managed OAuth

[Cloudflare Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/) supports this server without an OAuth implementation in the Worker. The server must be served through Cloudflare in the same account as the Zero Trust organization. MCP clients must support RFC 8707.

Access handles discovery, login, client registration, tokens, and refresh. Its OAuth tokens are opaque. Access resolves them and sends `Cf-Access-Jwt-Assertion` to the Worker. The Worker verifies the RS256 signature against the team's cached JWKS, issuer, application audience, expiration, and application token type. A non-empty verified `sub` selects the memory object. Email headers and raw bearer tokens are never trusted as identity.

Before deployment:

1. Confirm the custom domain `memsys.hopsken.com` configured in `wrangler.jsonc` belongs to your Cloudflare account.
2. Create an Access application covering the **whole hostname**, including `/mcp` and `/api/*`. Add a user Allow policy. Do not add Bypass or public paths.
3. Enable **Managed OAuth** in the application's Advanced settings. Allow only the redirect URIs required by your MCP clients; enable localhost/loopback redirects if your CLI client needs them.
4. Confirm the configured `ACCESS_ISSUER` (`https://hopsken.cloudflareaccess.com`) and `ACCESS_AUD` match that Access application.
5. Run `pnpm check`, then deploy when approved with `pnpm deploy`.
6. Connect an OAuth-capable MCP client to `https://<hostname>/mcp`. Check login and every tool. Check that unauthenticated API calls are blocked.

The default deployment returns 503 if either Access setting is empty, and 401 for missing or invalid assertions. `workers.dev` and preview URLs are disabled. This version uses human Access identities; service tokens without a user subject are not supported.

For the HTTP API, use a valid Access browser session or a Managed OAuth bearer token:

```sh
curl "https://<hostname>/api/remember" \
  -H "Authorization: Bearer $ACCESS_OAUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"fragment":"Durable Objects store memory. #memsys #cloudflare"}'
```

The Cloudflare edge supplies the signed assertion. Do not put an opaque OAuth token in `Cf-Access-Jwt-Assertion`.

## Development and checks

Node.js 24 and pnpm 11 are pinned through Mise. Hono handles routing; Zod schemas are shared by REST, MCP, and the object. Drizzle handles SQLite. Vitest tests run in the Workers runtime.

```sh
mise install
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm check       # Types, tests, production build, lint, format check
pnpm dev         # Vite frontend and local Worker; no login
pnpm eval        # Score recall on eval/dataset.ts; JEV=1 adds Jev (bills Workers AI)
```

`pnpm dev` uses local SQLite storage. The ignored `.dev.vars` file sets `DEV_IDENTITY=local-user` and clears both Access settings. The page, REST, and MCP share a test memory object named from `["local-dev", DEV_IDENTITY]`. Anyone with access to the dev server can change its test memory; do not store sensitive data there. Open `/` on the development server to view the memory page.

With the dev server running, `pnpm db:seed` replaces the test memory with a fixed eight-fragment corpus (`worker/dev/corpus.ts`) so the UI and recall have something to show. Set `SEED_URL` if the server is not on `http://localhost:5173`.

The development identity and everything under `worker/dev/` exist only in dev builds: they sit behind `import.meta.env.DEV`, which `vite build` replaces with `false`, so the deployed bundle contains neither the identity bypass nor the seed route.

`.dev.vars` is not deployed. Production still verifies Access, and either configured Access setting prevents the development bypass. To test Access locally, temporarily move `.dev.vars` aside and restart `pnpm dev` with a valid Access assertion. Test the full OAuth login flow on the deployed domain.

Tests use real JWT verification, SQLite objects, object eviction, and MCP protocol requests. Only the Access JWKS request is mocked, with temporary signing keys. No Cloudflare account is needed.

Tests are grouped by behavior in `tests/`: access and HTTP safety, REST and MCP contracts, edits and length limits, persistence, recall, pagination, plugins and their configuration, and development identity. `helpers.ts` contains only shared request and authentication setup. Keep assertions on returned data, rejected requests, identity isolation, and persisted results. Test matching and pagination edge cases with pure functions; test transport and storage behavior through their public interfaces. Do not lock tests to prose, generated schema formatting, cursor encoding, or SQL layout.

`worker-configuration.d.ts` is generated and ignored. Keep secrets in ignored `.dev.vars` files. `pnpm build` builds `dist/client` and `dist/memsys` locally; it does not deploy or run migrations on remote objects. `pnpm deploy` builds before deploying. A live Access OAuth login must be checked after the hostname and Access application are configured.
