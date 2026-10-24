import type { Scope } from "./lib/better-auth";
import type { MemoryService } from "./services/memory";

export interface AppEnv {
  Bindings: Env;
  Variables: {
    memory: MemoryService;
    scopes: ReadonlySet<Scope>;
    userId: string;
  };
}
