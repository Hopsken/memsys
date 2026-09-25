import { describe, expect, it } from "vitest";

import type { Fragment } from "../contract/memory";
import { corpus } from "../worker/dev/corpus";
import { post, useAuth } from "./helpers";

// RFC corpus labels: f1 is the first seeded fragment.
const label = (text: string) =>
  `f${corpus.findIndex((item) => item.fragment === text) + 1}`;

describe("Development seed", () => {
  const signIn = useAuth();

  it("seeds a signed-up user's memory with the test corpus, replacing what was there", async () => {
    const user = await signIn();
    await post("/api/remember", { fragment: "Replaced by the seed" }, user);
    const seeded = await post("/api/dev/seed", { email: user.email }, null);
    const recalled = await post("/api/recall", { cue: "US West" }, user);
    const { fragments } = await recalled.json<{
      fragments: (Fragment & { via?: string[] })[];
    }>();
    await expect(seeded.json()).resolves.toStrictEqual({ fragments: 8 });
    // IDF ranking lifts f7's rare #d1 above the #memsys hub; ties keep recency.
    expect(
      fragments.map(({ fragment, via }) => [label(fragment), via])
    ).toStrictEqual([
      ["f2", undefined],
      ["f1", ["cloudflare", "memsys"]],
      ["f7", ["d1", "memsys"]],
      ["f4", ["memsys"]],
      ["f6", ["memsys"]],
    ]);
  });

  it("refuses to seed an address that has not signed in", async () => {
    await expect(
      post("/api/dev/seed", { email: "nobody@memsys.test" }, null)
    ).resolves.toMatchObject({ status: 404 });
  });
});
