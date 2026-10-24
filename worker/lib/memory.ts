import type { Author, Memory } from "@core";
import { env } from "cloudflare:workers";

import { relevanceJudge } from "../clients/workers-ai";
import { MemoryService } from "../services/memory";

export const defaultSpace = (userId: string) => userId;

const memoryObject = (spaceId: string): Memory => env.MEMORY.getByName(spaceId);

export const openMemory = (spaceId: string, by: Author) =>
  new MemoryService(memoryObject(spaceId), { by, judge: relevanceJudge });
