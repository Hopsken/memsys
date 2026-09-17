import { DurableObject } from "cloudflare:workers";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { customAlphabet } from "nanoid";
import type { z } from "zod";

import migrations from "../migrations/migrations.js";
import { fragments, revisions } from "./db/schema";
import {
  fragmentWriteResult,
  inputs,
  listFragments,
  listInput,
  recall,
  REF_ALPHABET,
  REF_LENGTH,
  refInput,
  restoreInput,
  restReviseInput,
} from "./memory";
import type { Fragment, Revision } from "./memory";

const newRef = customAlphabet(REF_ALPHABET, REF_LENGTH);
const iso = (millis: number) => new Date(millis).toISOString();

export class MemoryDO extends DurableObject<Env> {
  private readonly db;
  private readonly createRef = newRef;
  // Latest revision per ref, split by archive state. A ref lives in exactly
  // one map; together they hold every ref ever issued.
  private readonly active = new Map<string, Fragment>();
  private readonly archived = new Map<string, Fragment>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.db = drizzle(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => {
      const result = await Promise.resolve(migrate(this.db, migrations));
      if (result !== undefined) {
        throw new Error(`[DB] migrations failed with code: ${result.exitCode}`);
      }
      for (const row of this.db.select().from(fragments).all()) {
        this.setHead(
          {
            createdAt: iso(row.createdAt),
            fragment: row.content,
            ref: row.ref,
            updatedAt: iso(row.updatedAt),
            version: row.version,
          },
          row.archived
        );
      }
    });
  }

  private head(ref: string) {
    return this.active.get(ref) ?? this.archived.get(ref);
  }

  private setHead(item: Fragment, archived: boolean) {
    this.active.delete(item.ref);
    this.archived.delete(item.ref);
    (archived ? this.archived : this.active).set(item.ref, item);
  }

  // The only write path: append one revision and move the head.
  private append(ref: string, content: string, archived: boolean): Fragment {
    const previous = this.head(ref);
    const now = Date.now();
    const version = (previous?.version ?? 0) + 1;
    const item = {
      createdAt: previous?.createdAt ?? iso(now),
      fragment: content,
      ref,
      updatedAt: iso(now),
      version,
    };
    const createdAt = Date.parse(item.createdAt);
    this.db.transaction((tx) => {
      tx.insert(revisions)
        .values({
          archived,
          content,
          createdAt: now,
          ref,
          version,
        })
        .run();
      tx.insert(fragments)
        .values({
          archived,
          content,
          createdAt,
          ref,
          updatedAt: now,
          version,
        })
        .onConflictDoUpdate({
          set: { archived, content, updatedAt: now, version },
          target: fragments.ref,
        })
        .run();
    });
    this.setHead(item, archived);
    return item;
  }

  remember(input: { fragment: string }) {
    const { fragment } = inputs.remember.parse(input);
    let ref = this.createRef();
    while (this.head(ref)) {
      ref = this.createRef();
    }
    return fragmentWriteResult(this.append(ref, fragment, false));
  }

  recall(input: { cue: string }) {
    return recall(this.active.values(), inputs.recall.parse(input).cue);
  }

  list(input: z.input<typeof listInput>) {
    const { archived } = listInput.parse(input);
    return listFragments(
      (archived ? this.archived : this.active).values(),
      input
    );
  }

  revise(input: z.input<typeof inputs.revise>) {
    const {
      ref,
      old_string: oldString,
      new_string: newString,
      replaceAll,
    } = inputs.revise.parse(input);
    const existing = this.active.get(ref);
    if (!existing) {
      return null;
    }
    const start = existing.fragment.indexOf(oldString);
    if (start === -1) {
      return {
        error:
          "old_string not found. Recall the fragment and use its exact text.",
      };
    }
    if (!replaceAll && existing.fragment.includes(oldString, start + 1)) {
      return {
        error:
          "old_string matches more than once. Include more context or set replaceAll to true.",
      };
    }
    const fragment = existing.fragment.replaceAll(oldString, () => newString);
    if (!restReviseInput.safeParse({ fragment, ref }).success) {
      return {
        error:
          "The resulting fragment must contain non-whitespace text and be at most 280 characters (Unicode grapheme clusters).",
      };
    }
    return this.replace({ fragment, ref });
  }

  replace(input: z.input<typeof restReviseInput>) {
    const { fragment, ref } = restReviseInput.parse(input);
    if (!this.active.has(ref)) {
      return null;
    }
    return fragmentWriteResult(this.append(ref, fragment, false));
  }

  // Archive: the fragment leaves recall and lists, but its history remains.
  forget(input: { ref: string }): { ref: string } | null {
    const { ref } = inputs.forget.parse(input);
    const existing = this.active.get(ref);
    if (!existing) {
      return null;
    }
    this.append(ref, existing.fragment, true);
    return { ref };
  }

  // Make `version` (default: latest) the current content and un-archive.
  // Restoring an active fragment to its current content writes nothing.
  restore(input: z.input<typeof restoreInput>) {
    const { ref, version } = restoreInput.parse(input);
    const existing = this.head(ref);
    if (!existing) {
      return null;
    }
    let content = existing.fragment;
    if (version !== undefined && version !== existing.version) {
      const row = this.db
        .select({ content: revisions.content })
        .from(revisions)
        .where(and(eq(revisions.ref, ref), eq(revisions.version, version)))
        .get();
      if (!row) {
        return null;
      }
      ({ content } = row);
    }
    if (this.active.has(ref) && content === existing.fragment) {
      return fragmentWriteResult(existing);
    }
    return fragmentWriteResult(this.append(ref, content, false));
  }

  history(input: {
    ref: string;
  }): { ref: string; revisions: Revision[] } | null {
    const { ref } = refInput.parse(input);
    if (!this.head(ref)) {
      return null;
    }
    return {
      ref,
      revisions: this.db
        .select()
        .from(revisions)
        .where(eq(revisions.ref, ref))
        .orderBy(asc(revisions.version))
        .all()
        .map((row) => ({
          archived: row.archived,
          createdAt: iso(row.createdAt),
          fragment: row.content,
          version: row.version,
        })),
    };
  }
}
