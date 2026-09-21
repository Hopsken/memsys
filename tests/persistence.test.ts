import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Memory persistence", () => {
  it("preserves writes, edits, and deletion after eviction without changing memory on recall", async () => {
    const memory = env.MEMORY.getByName("persistence");
    const seed = await memory.remember({
      fragment: "Durable objects #Programming",
    });
    const neighbor = await memory.remember({ fragment: "Workers #program" });
    await evictDurableObject(memory);
    await expect(
      memory.recall({ cue: " DURABLE\nobjects " })
    ).resolves.toMatchObject({
      associated: [{ ...neighbor, sharedAnchors: ["program"] }],
      recalled: [{ ...seed, anchors: ["programming"] }],
    });
    const revised = await memory.revise({
      new_string: "Workers #changed",
      old_string: neighbor.fragment,
      ref: neighbor.ref,
    });
    await evictDurableObject(memory);
    await expect(
      memory.recall({ cue: "Durable objects" })
    ).resolves.toMatchObject({ associated: [] });
    await expect(memory.recall({ cue: "Workers" })).resolves.toMatchObject({
      recalled: [{ ...revised, fragment: "Workers #changed" }],
    });
    await memory.forget({ ref: seed.ref });
    await evictDurableObject(memory);
    await expect(
      memory.recall({ cue: "Durable objects" })
    ).resolves.toMatchObject({ associated: [], recalled: [] });
    await expect(memory.list({})).resolves.toStrictEqual({
      fragments: [revised],
      nextCursor: null,
    });
  });
});
