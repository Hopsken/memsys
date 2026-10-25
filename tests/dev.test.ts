import type { Fragment } from "@core";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import worker from "../worker/index";
import { corpus } from "../worker/lib/dev-corpus";
import { list, ORIGIN, post, useAuth } from "./helpers";
import type { User } from "./helpers";

const label = (text: string) =>
  `f${corpus.findIndex((item) => item.fragment === text) + 1}`;

describe("Development seed", () => {
  const signIn = useAuth();

  it("adds the test corpus to a signed-up user's memory", async () => {
    const user = await signIn();
    await post("/api/remember", { fragment: "Kept beside the seed" }, user);
    const seeded = await post("/api/dev/seed", { email: user.email }, null);
    const recalled = await post("/api/recall", { cues: "US West" }, user);
    const { fragments } = await recalled.json<{
      fragments: (Fragment & { via?: string[] })[];
    }>();
    await expect(seeded.json()).resolves.toStrictEqual({
      conflicts: [],
      imported: 8,
      skipped: 0,
    });
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

const logMeIn = async (email: string, returnTo?: string) => {
  const query =
    returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(returnTo)}`;
  const response = await worker.fetch(
    new Request(`${ORIGIN}/__dev/log-me-in/${email}${query}`),
    env
  );
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  const user: User = { cookie, email, id: "", token: "" };
  return { location: response.headers.get("Location"), response, user };
};

describe("Development sign-in", () => {
  it("signs a new user in with the seed corpus and returns to the given path", async () => {
    const { location, response, user } = await logMeIn(
      `${crypto.randomUUID()}@memsys.test`,
      "/settings?tab=data#top"
    );
    expect(response.status).toBe(302);
    expect(location).toBe("/settings?tab=data#top");
    const { fragments } = await list(user);
    expect(fragments.map(({ fragment }) => fragment).toSorted()).toStrictEqual(
      corpus.map(({ fragment }) => fragment).toSorted()
    );
  });

  it("signs an existing user in again without replacing their memory", async () => {
    const email = `${crypto.randomUUID()}@memsys.test`;
    const first = await logMeIn(email);
    await post(
      "/api/remember",
      { fragment: "Kept across sign-ins" },
      first.user
    );
    const again = await logMeIn(email);
    const { fragments } = await list(again.user);
    expect(fragments).toHaveLength(corpus.length + 1);
    expect(fragments.map(({ fragment }) => fragment)).toContain(
      "Kept across sign-ins"
    );
  });

  it.each([
    undefined,
    "",
    "settings",
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "/\t/evil.example/",
  ])("returns to / instead of %j", async (returnTo) => {
    const { location } = await logMeIn(
      `${crypto.randomUUID()}@memsys.test`,
      returnTo
    );
    expect(location).toBe("/");
  });
});
