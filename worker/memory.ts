import type { Memory } from "@core";
import { env } from "cloudflare:workers";

import { MemoryService } from "./services/memory";

export const defaultSpace = (userId: string) => userId;

const memoryObject = (spaceId: string): Memory => env.MEMORY.getByName(spaceId);

export const openMemory = (spaceId: string) =>
  new MemoryService(
    memoryObject(spaceId),
    env.DEEPSEEK_API_KEY,
    env.DEEPSEEK_BASE_URL
  );
