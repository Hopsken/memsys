# Portability

Memory is an append-only log ([RFC 0001](rfcs/0001-append-only-fragment-log.md)): every change is a record, so nothing is overwritten. Export and import move that record between instances.

Both live under **Settings → Data**.

## Export

Export downloads your memory as a file with one record per line, starting with the agents you have named. By default it holds your current memories, each with who wrote it and when. Turn on **Include earlier versions and forgotten memories** to get the whole log instead: every version and every forgotten memory.

Settings, API keys, and app connections stay behind. Set them up on the new instance.

## Import

Import adds a file to this memory, up to 10 MB. It only adds:

- A memory this instance does not have arrives with its whole history.
- A memory it already knows is left alone when the text matches, and reported as a conflict when it does not.
- Text it already holds is skipped.

A plain text file works too: each non-empty line becomes a new memory, written by you.

An import stores every line or nothing. A line that fails validation returns its error and nothing is written. Your own **Settings → Features** limits do not apply to imported memories, though the absolute limit memsys always enforces still does.

The owner does this in the web UI. Agents read and write memory, but they cannot move it in or out.
