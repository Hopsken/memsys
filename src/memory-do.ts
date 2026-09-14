import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

import migrations from "../migrations/migrations.js";

export class MemoryDO extends DurableObject<Env> {
  private readonly db;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.db = drizzle(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => {
      const result = await Promise.resolve(migrate(this.db, migrations));
      if (result !== undefined) {
        throw new Error(`[DB] migrations failed with code: ${result.exitCode}`);
      }
    });
  }
}
