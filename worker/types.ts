import type { Memory } from "@core";

import type { Author } from "@contract/memory";

import type { Scope } from "./lib/better-auth";

export interface AppEnv {
  Bindings: Env;
  Variables: {
    by: Author;
    memory: Memory;
    scopes: ReadonlySet<Scope>;
    userId: string;
  };
}
