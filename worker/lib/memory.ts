import { env } from "cloudflare:workers";

// A memory space id names one memory object. Each user has a default space
// whose id is their user id; this is the only place that ties the two, so
// more spaces per user, or another sign-in system, change only this.
export const defaultSpace = (userId: string) => userId;

export const memoryOf = (spaceId: string) => env.MEMORY.getByName(spaceId);
