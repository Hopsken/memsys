import type { Author } from "../contract/memory";
import type { MemoryDO } from "../core/do";
import type { Scope } from "./lib/better-auth";

// What the sign-in middlewares hand to every route: who is calling, and
// whose memory they reach.
export interface AppEnv {
  // Better Auth keeps one instance per env object, so it reads c.env;
  // everything else reads the global env from cloudflare:workers.
  Bindings: Env;
  Variables: {
    // Who writes through this request, recorded with each record.
    by: Author;
    memory: DurableObjectStub<MemoryDO>;
    scopes: ReadonlySet<Scope>;
    userId: string;
  };
}
