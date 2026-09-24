import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { Fragment } from "../contract/memory";

describe("Memory persistence", () => {
  it("preserves writes, edits, and deletion after eviction without changing memory on recall", async () => {
    const memory = env.MEMORY.getByName("persistence");
    const remember = async (fragment: string): Promise<Fragment> => {
      const result = await memory.remember({ fragment });
      if ("error" in result) {
        throw new Error(result.error);
      }
      return result;
    };
    const seed = await remember("Durable objects #Programming");
    const neighbor = await remember("Workers #program");
    await evictDurableObject(memory);
    await expect(
      memory.recall({ cue: " DURABLE\nobjects " })
    ).resolves.toStrictEqual({
      fragments: [seed, { ...neighbor, via: ["program"] }],
      hasMore: false,
    });
    const revised = await memory.revise({
      fragment: "Workers #changed",
      ref: neighbor.ref,
    });
    await evictDurableObject(memory);
    await expect(
      memory.recall({ cue: "Durable objects" })
    ).resolves.toStrictEqual({ fragments: [seed], hasMore: false });
    await expect(memory.recall({ cue: "Workers" })).resolves.toMatchObject({
      fragments: [{ ...revised, fragment: "Workers #changed" }],
    });
    await memory.forget({ ref: seed.ref });
    await evictDurableObject(memory);
    await expect(
      memory.recall({ cue: "Durable objects" })
    ).resolves.toStrictEqual({ fragments: [], hasMore: false });
    await expect(memory.list({})).resolves.toStrictEqual({
      fragments: [revised],
      nextCursor: null,
    });
  });
});
