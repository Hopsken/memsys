# memsys

A tiny associative memory system for agents. Fragments are plain text; shared hashtags associate them.

Store one durable idea per fragment. Recall starts from a textual cue and follows explicit anchors, not inferred relationships. Fragments are the source of truth; tags and associations are derived. Vector search, automatic summaries, and memory reinforcement are outside the current scope.

To connect the deployed server, follow [Use memsys in ChatGPT](docs/chatgpt.md).

[Project Vision](docs/VISION.md) [Architecture](docs/Architecture.md)

## Memory page

Open `/` to view your fragments. The read-only React page shows plain text, refs, and last-update times in your browser's timezone. Use **Load more** for older fragments and **Refresh** to restart the list. Create, revise, and delete fragments through your connected agent or the API.

The app uses Vite, React, Tailwind CSS 4, and shadcn/ui in `client/`. Hono, authentication, MCP, and the Durable Object live in `worker/`. The Cloudflare Vite plugin serves both from one origin. Cloudflare Access protects the whole hostname; the browser sends same-origin requests without storing tokens. API and MCP paths always run through the Worker rather than the HTML fallback.

## API

`/mcp` serves the five tools below through `@hono/mcp`, using stateless Streamable HTTP. Each POST creates a new MCP server and transport. There are no MCP session IDs, notification streams, or session Durable Objects. GET and DELETE return 405.

The JSON HTTP API exposes the fragment operations with the same inputs as MCP; `list_tags` is MCP-only:

| MCP tool | HTTP endpoint | JSON input |
| --- | --- | --- |
| `remember` | `POST /api/remember` | `{ "fragment": "Durable Objects store memory. #memsys #cloudflare" }` |
| `recall` | `POST /api/recall` | `{ "cue": "durable objects", "limit": 20, "associate": true, "context": "…" }` |
| `list_tags` | — | `{}` |
| `revise` | `POST /api/revise` | `{ "ref": "7x9c2pa", "fragment": "Replacement text. #memsys" }` |
| `forget` | `POST /api/forget` | `{ "ref": "7x9c2pa" }` |

`revise` replaces the full text of a fragment. The replacement must be non-blank and meet the character limits below. A failed revise leaves content and timestamps unchanged.

`remember` returns 201; other successful HTTP operations return 200. `remember` and `revise` return `{ ref, fragment, createdAt, updatedAt }`. Timestamps use UTC ISO 8601. `forget` returns `{ ref }`. Unknown refs return HTTP 404 or an MCP tool error. Invalid HTTP input returns 400; bodies over 32 KiB return 413.

Fragments have a **300-character soft limit** and a **500-character hard limit**. `remember` and `revise` accept 301–500 characters but add a `warnings` array of messages to the result, for both HTTP and MCP. More than 500 characters is rejected without writing. Warnings are not stored. Existing longer fragments remain readable; revisions must meet the new limit.

Length uses Unicode grapheme clusters (`Intl.Segmenter`), not UTF-8 bytes or JavaScript UTF-16 code units. A Chinese character, `👍🏽`, `👨‍👩‍👧‍👦`, and `e` with a combining acute accent each count as one character. Spaces, punctuation, and `#anchors` also count. Text is stored unchanged, and blank fragments are rejected. The separate 32 KiB request-body limit still applies.

REST POST requests require `Content-Type: application/json` (optional parameters such as `charset=utf-8` are allowed); other media types return 415. REST and MCP reject a supplied `Origin` unless it exactly matches the request URL's origin, returning 403. Non-browser clients may omit `Origin`.

`recall` accepts `cue` (required), `limit` (1–50, default 20), `associate` (default `true`), and `context` (optional free text describing the current task; accepted for plugins, ignored by core). It returns:

```json
{
  "fragments": [
    {
      "ref": "7x9c2pa",
      "fragment": "Durable Objects store memory. #memsys #cloudflare",
      "createdAt": "2026-09-14T00:00:00.000Z",
      "updatedAt": "2026-09-14T00:00:00.000Z"
    },
    {
      "ref": "k3m8q2x",
      "fragment": "D1 primary is in us-west. #cloudflare #d1",
      "createdAt": "2026-09-10T00:00:00.000Z",
      "updatedAt": "2026-09-10T00:00:00.000Z",
      "via": ["cloudflare"]
    }
  ],
  "hasMore": false
}
```

Fragments matching the cue come first. Fragments with `via` were associated through the listed anchors.

MCP `list_tags` returns a JSON array containing every unique anchor name currently used by the authenticated user's fragments, lowercased and sorted. Names remain complete and are not stemmed or merged with synonyms. It returns `[]` when the memory store has no anchors. Agents should call it once when they begin using the store in a new context, then reuse a listed tag when it fits or create a new one when needed; they need not call it every turn or before each `remember`.

### List fragments

`GET /api/fragments` returns `{ fragments, nextCursor }`. Each fragment contains `{ ref, fragment, createdAt, updatedAt }`. This read-only endpoint uses the same verified identity as REST and MCP and sends `Cache-Control: no-store`.

Pages contain up to 50 items, ordered by `updatedAt` descending and then ref ascending. Pass the returned cursor with `URLSearchParams` as `?cursor=...` to get the next page. `nextCursor: null` marks the end. Invalid cursors or unknown query fields return 400. Fragment pagination remains HTTP-only, and `list_tags` requires no database migration.

Pagination is not a snapshot: new or revised fragments can move ahead of the cursor. Refresh to see current data. Deleting the cursor's fragment does not prevent loading the next page.

### Memory rules

- Refs use Nano ID with 7 characters from `23456789abcdefghjkmnpqrstuvwxyz`. There are about 27.5 billion possible refs. At 10,000 records, the chance of at least one collision is about 0.18% before retries. The object retries occupied refs; it never replaces a fragment on collision. Refs are identifiers, not credentials. Shorter text does not guarantee a specific tokenizer count.
- Fragment length follows the grapheme limits above. Cues can have up to 256 UTF-16 code units after trimming.
- Recall normalizes case and whitespace, then matches the complete cue as a substring. `durable objects` matches `Durable\nObjects`, but not `objects are durable`.
- Anchors contain Unicode letters, numbers, `_`, `-`, or `/`. They start at a text boundary, so URL fragments, embedded `word#tags`, and Markdown `##headings` are not anchors. Anchors are lowercase and deduplicated. Namespace matching is exact: `#project/a` does not match `#project/ab`.
- Association splits anchors without `/` at `-` and compares any shared word in both directions. Pure English-letter words use Porter2 stemming: `#agents`, `#agent-memory`, and `#agent-tools` link fragments; `#memory` also links to `#agent-memory`. Empty words are ignored. Words with numbers, non-English characters, or `_` require exact lowercase matches. Anchors with `/` require a complete exact lowercase match and are not split or stemmed. Stemming applies only to association, not cue matching or stored text. Returned `via` anchors keep each fragment's complete lowercase tag spelling, not its stem.
- Results hold at most `limit` items: cue matches first, then associated fragments, each group ordered by last update, newest first, then ref. Only returned matches seed association, so associations appear only when every match fits. Matches never repeat as associations. Association is one hop, not recursive. `hasMore` reports omitted results; raise `limit` or use a narrower cue when needed.
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
6. Connect an OAuth-capable MCP client to `https://<hostname>/mcp`. Check login and all five tools. Check that unauthenticated API calls are blocked.

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
```

`pnpm dev` uses local SQLite storage. The ignored `.dev.vars` file sets `DEV_IDENTITY=local-user` and clears both Access settings. The page, REST, and MCP share a test memory object named from `["local-dev", DEV_IDENTITY]`. Anyone with access to the dev server can change its test memory; do not store sensitive data there. Open `/` on the development server to view the memory page.

`.dev.vars` is not deployed. Production still verifies Access, and either configured Access setting prevents the development bypass. To test Access locally, temporarily move `.dev.vars` aside and restart `pnpm dev` with a valid Access assertion. Test the full OAuth login flow on the deployed domain.

Tests use real JWT verification, SQLite objects, object eviction, and MCP protocol requests. Only the Access JWKS request is mocked, with temporary signing keys. No Cloudflare account is needed.

Tests are grouped by behavior in `tests/`: access and HTTP safety, REST and MCP contracts, edits and length limits, persistence, recall, pagination, and development identity. `helpers.ts` contains only shared request and authentication setup. Keep assertions on returned data, rejected requests, identity isolation, and persisted results. Test matching and pagination edge cases with pure functions; test transport and storage behavior through their public interfaces. Do not lock tests to prose, generated schema formatting, cursor encoding, or SQL layout.

`worker-configuration.d.ts` is generated and ignored. Keep secrets in ignored `.dev.vars` files. `pnpm build` builds `dist/client` and `dist/memsys` locally; it does not deploy or run migrations on remote objects. `pnpm deploy` builds before deploying. A live Access OAuth login must be checked after the hostname and Access application are configured.
