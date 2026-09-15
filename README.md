# memsys

A tiny associative memory system for agents. Fragments are plain text; shared hashtags associate them. See [the project brief](docs/project-brief.md).

## API

`/mcp` serves the four tools below through `@hono/mcp`, using stateless Streamable HTTP. Each POST creates a new MCP server and transport. There are no MCP session IDs, notification streams, or session Durable Objects. GET and DELETE return 405.

The JSON HTTP API uses the same inputs and memory operations:

| MCP tool | HTTP endpoint | JSON input |
| --- | --- | --- |
| `remember` | `POST /api/remember` | `{ "fragment": "Durable Objects store memory. #memsys #cloudflare" }` |
| `recall` | `POST /api/recall` | `{ "cue": "durable objects" }` |
| `revise` | `POST /api/revise` | `{ "ref": "7x9c2pa", "fragment": "Replacement text. #memsys" }` |
| `forget` | `POST /api/forget` | `{ "ref": "7x9c2pa" }` |

`remember` returns 201; other successful HTTP operations return 200. `remember` and `revise` return `{ ref, fragment, createdAt, updatedAt }`. Timestamps use UTC ISO 8601. `forget` returns `{ ref }`. Unknown refs return HTTP 404 or an MCP tool error. Invalid HTTP input returns 400; bodies over 32 KiB return 413.

`recall` returns:

```json
{
  "recalled": [
    {
      "ref": "7x9c2pa",
      "fragment": "Durable Objects store memory. #memsys #cloudflare",
      "createdAt": "2026-09-14T00:00:00.000Z",
      "updatedAt": "2026-09-14T00:00:00.000Z",
      "anchors": ["cloudflare", "memsys"]
    }
  ],
  "associated": [],
  "hasMoreRecalled": false,
  "hasMoreAssociated": false
}
```

Associated items contain `sharedAnchors` instead of `anchors`.

### Memory rules

- Refs use Nano ID with 7 characters from `23456789abcdefghjkmnpqrstuvwxyz`. There are about 27.5 billion possible refs. At 10,000 records, the chance of at least one collision is about 0.18% before retries. The object retries occupied refs; it never replaces a fragment on collision. Refs are identifiers, not credentials. Shorter text does not guarantee a specific tokenizer count.
- Fragments must contain non-whitespace text and can have up to 4,096 UTF-16 code units. The original text is preserved. Cues can have up to 256 code units after trimming.
- Recall normalizes case and whitespace, then matches the complete cue as a substring. `durable objects` matches `Durable\nObjects`, but not `objects are durable`.
- Anchors contain Unicode letters, numbers, `_`, `-`, or `/`. They start at a text boundary, so URL fragments, embedded `word#tags`, and Markdown `##headings` are not anchors. Anchors are lowercase and deduplicated. Namespace matching is exact: `#project/a` does not match `#project/ab`.
- Each result list is limited to 20 items, ordered by last update, newest first, then ref. Only returned recalled items seed association. All lexical matches are excluded from the associated list. Association is one hop, not recursive. Truncation flags report omitted results; use a narrower cue when needed.
- Recall is read-only. No embeddings, scores, tags, edges, or recall history are stored.

## Storage

One SQLite Durable Object holds each user's memory. Its name is `JSON.stringify([verifiedIssuer, verifiedSubject])`. REST and MCP use the same object. Clients cannot select another user's memory space.

`fragments` is the only domain table. Drizzle migrations run inside `blockConcurrencyWhile` before the object accepts requests. The object then loads all fragments into a map. Writes update SQLite before the map. Object eviction removes only the map; the next instance rebuilds it from SQLite. Anchor and search results are disposable projections.

For future schema changes:

```sh
pnpm db:generate descriptive-migration-name
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
6. Connect an OAuth-capable MCP client to `https://<hostname>/mcp`. Check login and all four tools. Check that unauthenticated API calls are blocked.

The Worker returns 503 if either Access setting is empty, and 401 for missing or invalid assertions. `workers.dev` and preview URLs are disabled. No alternate public route or local auth bypass is provided. This version uses human Access identities; service tokens without a user subject are not supported.

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
pnpm check       # Types, tests, dry-run build, lint, format check
pnpm dev         # Local Worker; auth remains required
```

Tests generate temporary signing keys and mock only the Access JWKS request. They use real JWT verification, SQLite objects, object eviction, and MCP protocol requests. No Cloudflare account is needed for these tests. Local HTTP requests need a valid Access assertion and matching `.dev.vars`; otherwise use the tests to exercise the system.

`worker-configuration.d.ts` is generated and ignored. Keep secrets in ignored `.dev.vars` files. `pnpm build` is a local dry-run bundle; it does not deploy or run migrations on remote objects. A live Access OAuth login must be checked after the hostname and Access application are configured.
