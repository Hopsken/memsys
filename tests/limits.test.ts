import type { Fragment } from "@core";
import { describe, expect, it } from "vitest";

import { list, patchSettings, post, useAuth } from "./helpers";
import type { User } from "./helpers";

type WriteResult = (Fragment & { warnings?: string[] }) | { error: string };

const write = async (
  user: User,
  args: { fragment: string; ref?: string }
): Promise<WriteResult> => {
  const response = await post(
    args.ref ? "/api/revise" : "/api/remember",
    args,
    user
  );
  return response.json<WriteResult>();
};

const warnings = (result: WriteResult) =>
  "error" in result ? "error" : (result.warnings?.length ?? 0);

describe("Fragment length limits", () => {
  const signIn = useAuth();

  it("warns above 300 and rejects above 500 by default without writing", async () => {
    const user = await signIn();
    const saved = await write(user, { fragment: "x" });
    const ref = "ref" in saved ? saved.ref : "";
    const results = await Promise.all(
      [300, 301, 500, 501].flatMap((length) => [
        write(user, { fragment: "x".repeat(length) }),
        write(user, { fragment: "y".repeat(length), ref }),
      ])
    );
    expect(results.map(warnings)).toStrictEqual([
      0,
      0,
      1,
      1,
      1,
      1,
      "error",
      "error",
    ]);
    const page = await list(user);
    expect(page.fragments).toHaveLength(4);
  });

  it("returns 422 above the owner's limit and 400 above the core ceiling", async () => {
    const user = await signIn();
    const statuses = await Promise.all(
      [501, 1000, 1001].map(async (length) => {
        const response = await post(
          "/api/remember",
          { fragment: "x".repeat(length) },
          user
        );
        return response.status;
      })
    );
    expect(statuses).toStrictEqual([422, 422, 400]);
  });

  it("applies the owner's limits and keeps the core ceiling when they are at most", async () => {
    const user = await signIn();
    await patchSettings(user, { length: { refuse: 10, warn: 5 } });
    const tight = await Promise.all(
      [5, 6, 11].map(async (length) =>
        warnings(await write(user, { fragment: "x".repeat(length) }))
      )
    );
    await patchSettings(user, { length: { refuse: 1000, warn: 1000 } });
    const off = await Promise.all(
      [1000, 1001].map(async (length) =>
        warnings(await write(user, { fragment: "x".repeat(length) }))
      )
    );
    expect({ off, tight }).toStrictEqual({
      off: [0, "error"],
      tight: [0, 1, "error"],
    });
  });
});
