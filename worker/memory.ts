import type { Memory } from "@core";
import { env } from "cloudflare:workers";
import { z } from "zod";

import { jev } from "./clients/jev";
import { workersAiFetch } from "./clients/workers-ai";
import { MemoryService } from "./services/memory";

const relevanceJudge = jev(
  workersAiFetch({
    run: async (model, input) => z.json().parse(await env.AI.run(model, input)),
  })
);

export const defaultSpace = (userId: string) => userId;

const memoryObject = (spaceId: string): Memory => env.MEMORY.getByName(spaceId);

export const openMemory = (spaceId: string) =>
  new MemoryService(memoryObject(spaceId), relevanceJudge);
