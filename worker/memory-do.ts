import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { customAlphabet } from "nanoid";

import migrations from "../migrations/migrations.js";
import { fragments } from "./db/schema";
import {
  inputs,
  listFragments,
  recall,
  REF_ALPHABET,
  REF_LENGTH,
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

  remember(input: { fragment: string }): Fragment {
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
    return item;
  }

  recall(input: { cue: string }) {
    return recall(this.corpus.values(), inputs.recall.parse(input).cue);
  }

  list(input: { cursor?: string }) {
    return listFragments(this.corpus.values(), input);
  }

  revise(input: { ref: string; fragment: string }): Fragment | null {
    const { ref, fragment } = inputs.revise.parse(input);
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
    return item;
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
