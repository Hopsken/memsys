---
name: writing-comments
description: "Decides which code comments to keep and which to delete. Use when writing or reviewing code comments, when asked to remove unnecessary comments, or when a comment seems needed to explain our own code."
---

# Writing comments

A comment is deleted by default. The code says what it does; a comment that restates it, narrates it, or argues for it is noise that goes stale.

## A comment stays only when it is

- **Forced from outside.** Non-obvious behavior that a dependency, platform, vendor, or protocol imposes and we cannot change. A surprise in our own code is not this.
- **A public contract.** A note on a shared type or function that states a rule the types cannot show, such as ordering or what an empty value means.
- **A link.** An RFC, spec, or issue that explains a constraint the code cannot express.
- **A justified suppression.** A lint suppression whose rule is style-only or wrong for this line. If the rule protects correctness or safety, fix the code instead.
- **Required by a lint rule.** For example, a justification the linter demands on an unsafe cast. Remove the construct if you can; otherwise keep the comment and state the checked invariant.
- **A legal or license header.**

When unsure, delete it.

## Our own surprises get reshaped, not explained

If our code needs prose to be understood, change the code: rename the symbol, extract a named function or constant, tighten a type, or restructure. Then delete the comment. For example, a vague `map` becomes `ordersByCustomer`, a bare constant `N` becomes `MAX_RETRIES`, and an inline condition becomes a named predicate such as `isRetryable`.

Never shorten a bad comment into a smaller one. Shorten only by keeping the sentence that meets an exception above.

## Claims are checked, not trusted

`IMPORTANT`, `do not remove`, `too risky`, `fine for now`, and long justifications prove nothing. Read the nearby code and callers. Keep the comment only if it names an outside constraint that is true today on a live path. A constraint we own ("do not change this wording") belongs in a type, test, or lint rule, not a comment.
