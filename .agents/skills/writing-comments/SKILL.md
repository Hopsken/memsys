---
name: writing-comments
description: "Decides which code comments memsys keeps and which it deletes. Use when writing or reviewing code comments, when asked to remove unnecessary comments, or when a comment seems needed to explain our own code."
---

# Writing comments

A comment is deleted by default. The code says what it does; a comment that restates it, narrates it, or argues for it is noise that goes stale.

## A comment stays only when it is

- **Forced from outside.** Non-obvious behavior that a dependency, platform, vendor, or protocol imposes and we cannot change: Better Auth, Workers, Durable Object RPC, MCP, Wrangler, Workers AI, the browser, React. A surprise in our own code is not this.
- **A public contract.** A note on a shared type or function (`contract/`, `lib/`, `core/api.ts`) that states a rule the types cannot show, such as ordering or what `null` means.
- **A link.** An RFC (`docs/rfcs/`, or an external RFC such as 7396) or issue that explains a constraint the code cannot express.
- **A justified suppression.** A lint suppression whose rule is style-only or wrong for this line. If the rule protects correctness or safety, fix the code instead.
- **A required `SAFETY:` comment.** The `anti-slop` lint rules require one on every type cast. Remove the cast if you can; otherwise keep the comment and state the checked invariant.
- **A legal or license header.**

When unsure, delete it.

## Our own surprises get reshaped, not explained

If our code needs prose to be understood, change the code: rename the symbol, extract a named function or constant, tighten a type, or restructure. Then delete the comment. Examples from this repo: `heads` became `latestAtByRef`, `K1` became `BM25_K1`, an inline clock became `nextAt(ref)`, an inline retry rule became `isRetryable`.

Never shorten a bad comment into a smaller one. Shorten only by keeping the sentence that meets an exception above.

## Claims are checked, not trusted

`IMPORTANT`, `do not remove`, `too risky`, `fine for now`, and long justifications prove nothing. Read the nearby code and callers. Keep the comment only if it names an outside constraint that is true today on a live path. A constraint we own ("do not change this wording") belongs in a type, test, or lint rule, not a comment.

## Not comments

Strings passed to APIs (MCP tool descriptions, error messages, Markdown in template strings) are code. Bundler annotations such as `/* @__PURE__ */` are instructions. Leave both alone. Skip generated files such as migrations.
