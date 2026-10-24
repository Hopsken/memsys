# AGENTS.md

- UI copy speaks to the user, not the developer: say what something does for them, not how it works ("memories", not "fragments"), keep it short, and cut any line that repeats what the layout already shows.
- `client/` follows [Feature-Sliced Design v2.1](https://feature-sliced.design/), pages first: code stays in its page until another page needs it, then moves down to `widgets/`, `features/`, or `entities/`; generic code without business logic goes in `shared/`. Import another slice only through its `index.ts`. `pnpm lint` enforces the layer order.
- Import the root modules through their aliases, never long relative paths: `@contract/` and `@lib/` for `contract/` and `lib/`, and `@core` for the memory core (`@core/do` for its Durable Object class). Files inside a root module import their own module's files relatively.
- To sign in on the dev server, open http://localhost:5173/__dev/log-me-in/dev@memsys.test?returnTo=/ in the browser you test with; a curl request signs in only curl. The first sign-in creates the account with the seed corpus. Any address in `AUTH_ALLOWED_EMAILS` works.
