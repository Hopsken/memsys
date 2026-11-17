# Deployment

memsys runs on Cloudflare Workers, with D1 for the Worker's database and one SQLite Durable Object per person for their memory. `pnpm deploy` builds, applies D1 migrations remotely, and deploys.

## Before the first deployment

1. Create the database with `pnpm exec wrangler d1 create memsys` and add its `database_id` to `wrangler.jsonc`.
2. Verify a sending domain in [Resend](https://resend.com/).
3. Set the Worker's variables and secrets in the Cloudflare dashboard (**Workers & Pages → memsys → Settings → Variables and Secrets**); `.dev.vars.example` lists them all. `wrangler.jsonc` sets `keep_vars`, so deploys leave them alone; nothing instance-specific lives in the repository.
4. Run `pnpm check`, then `pnpm deploy`.
5. After the first deploy, add a custom domain to the Worker in the Cloudflare dashboard (**Settings → Domains & Routes**). `wrangler.jsonc` names no domain, and deploys leave the one you add in place. `workers.dev` and preview URLs are disabled.

## Variables and secrets

| Name | Value |
| --- | --- |
| `PUBLIC_URL` | The custom domain's origin, such as `https://memsys.example.com` |
| `EMAIL_FROM` | An address on the verified Resend domain |
| `BETTER_AUTH_SECRET` | A secret of at least 32 random characters, such as `openssl rand -base64 32` |
| `RESEND_API_KEY` | A Resend API key |
| `DEEPSEEK_API_KEY` | A DeepSeek API key for the memory model |
| `DEEPSEEK_BASE_URL` | Optional: an OpenAI-compatible gateway to use instead of `https://api.deepseek.com` |

Store `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, and `DEEPSEEK_API_KEY` as secrets. A production build refuses to sign in without `RESEND_API_KEY` and `EMAIL_FROM`; a dev build prints sign-in codes in the dev server log instead.

## Email and invitations

Sign-in codes go out through Resend. memsys is invite-only: an address without an account gets a code only with a usable invite code, and creating the account uses up one use of that invite. New users open the invite link or enter its code on the join page; existing users just sign in and never need one.

`pnpm invite --remote` creates a code in the production database and prints its link (`--uses` and `--days` set how many accounts it can create and when it expires, by default 1 and 7); `pnpm invite --remote --list` shows every code and how much of it is used. Both use your Wrangler login, as `pnpm deploy` does; set `PUBLIC_URL` to print full links. Sign-in attempts and invite checks are rate limited per client address.

## Access

There are three credentials, and each reaches only its own side:

| Credential | Held by | Reaches |
| --- | --- | --- |
| Session cookie, from an emailed one-time code | The browser | The web UI: memory, settings, API key and app management |
| OAuth access token, from signing in through an agent | An agent | MCP only, limited to the scopes the user allowed |
| API key (`memsys_…`), created under **Settings → MCP** | An agent | MCP only, limited to the access chosen when the key was created |

Neither agent credential stands in for a session, so an agent cannot change settings, create API keys, or manage apps, and a session cookie does not open MCP.

**OAuth.** memsys is an OAuth 2.1 authorization server for MCP. An agent that connects asks for a token, registers itself, and sends the person to sign in and approve the connection. Two scopes decide which tools the agent sees: `memory:read` for `recall` and `memory:write` for `note`, and a connection needs at least one. Access tokens last an hour and renew on their own. Disconnecting an app under **Settings → MCP** takes effect at once.

**API keys** are for agents that cannot sign in. A new key has write access unless you uncheck it, so a read-only key sees only `recall`. The web UI shows each key once, when it is created, and revoking one takes effect on the next request.

## Checking a deployment

Check a live email sign-in after the first deployment. Then connect an MCP client by signing in, and another with an API key. Check `recall` and `note`, that a read-only key sees only `recall`, that a key with write sees both tools, and that neither agent credential opens the web UI.
