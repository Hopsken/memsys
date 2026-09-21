import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { customAlphabet } from "nanoid";
import type { z } from "zod";

import migrations from "../migrations/migrations.js";
import { fragments } from "./db/schema";
import {
  fragmentWriteResult,
  inputs,
  listFragments,
  listTags,
  recall,
  REF_ALPHABET,
  REF_LENGTH,
  restReviseInput,
} from "./memory";
import type { Fragment } from "./memory";

const newRef = customAlphabet(REF_ALPHABET, REF_LENGTH);

export class MemoryDO extends DurableObject<Env> {
  private readonly db;
  private readonly corpus = new Map<string, Fragment>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.db = drizzle(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => {
      const result = await Promise.resolve(migrate(this.db, migrations));
      if (result !== undefined) {
        throw new Error(`[DB] migrations failed with code: ${result.exitCode}`);
      }
      for (const row of this.db.select().from(fragments).all()) {
        this.corpus.set(row.id, {
          createdAt: new Date(row.createdAt).toISOString(),
          fragment: row.content,
          ref: row.id,
          updatedAt: new Date(row.updatedAt).toISOString(),
        });
      }
    });
  }

  remember(input: { fragment: string }) {
    const { fragment } = inputs.remember.parse(input);
    let ref = newRef();
    while (this.corpus.has(ref)) {
      ref = newRef();
    }
    const now = Date.now();
    const item = {
      createdAt: new Date(now).toISOString(),
      fragment,
      ref,
      updatedAt: new Date(now).toISOString(),
    };
    this.db
      .insert(fragments)
      .values({ content: fragment, createdAt: now, id: ref, updatedAt: now })
      .run();
    this.corpus.set(ref, item);
    return fragmentWriteResult(item);
  }

  recall(input: { cue: string }) {
    return recall(this.corpus.values(), inputs.recall.parse(input).cue);
  }

  list(input: { cursor?: string }) {
    return listFragments(this.corpus.values(), input);
  }

  listTags() {
    return listTags(this.corpus.values());
  }

  revise(input: z.input<typeof inputs.revise>) {
    const {
      ref,
      old_string: oldString,
      new_string: newString,
      replaceAll,
    } = inputs.revise.parse(input);
    const existing = this.corpus.get(ref);
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
          "The resulting fragment must contain non-whitespace text and be at most 500 characters (Unicode grapheme clusters).",
      };
    }
    return this.replace({ fragment, ref });
  }

  replace(input: z.input<typeof restReviseInput>) {
    const { fragment, ref } = restReviseInput.parse(input);
    const existing = this.corpus.get(ref);
    if (!existing) {
      return null;
    }
    const now = Date.now();
    const item = {
      ...existing,
      fragment,
      updatedAt: new Date(now).toISOString(),
    };
    this.db
      .update(fragments)
      .set({ content: fragment, updatedAt: now })
      .where(eq(fragments.id, ref))
      .run();
    this.corpus.set(ref, item);
    return fragmentWriteResult(item);
  }

  forget(input: { ref: string }): { ref: string } | null {
    const { ref } = inputs.forget.parse(input);
    if (!this.corpus.has(ref)) {
      return null;
    }
    this.db.delete(fragments).where(eq(fragments.id, ref)).run();
    this.corpus.delete(ref);
    return { ref };
  }
}
