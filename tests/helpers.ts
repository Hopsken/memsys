import type { Fragment, FragmentPage, ListedFragment } from "@core";
import { env } from "cloudflare:workers";
import type { JSONValue } from "hono/utils/types";
import { afterAll, beforeAll, vi } from "vitest";
import { z } from "zod";

import worker from "../worker/index";
import { defaultSpace } from "../worker/memory";

export const ORIGIN = "https://memsys.test";

export interface User {
  cookie: string;
  email: string;
  id: string;
  token: string;
}

const credentials = (path: string, user: User | null) => {
  if (!user) {
    return {};
  }
  return path.startsWith("/mcp")
    ? { Authorization: `Bearer ${user.token}` }
    : { Cookie: user.cookie };
};

export const post = (
  path: string,
  body: JSONValue,
  user: User | null,
  headers: Record<string, string> = {}
) =>
  worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...credentials(path, user),
        ...headers,
      },
      method: "POST",
    }),
    env
  );

export const randomIp = () =>
  [10, ...crypto.getRandomValues(new Uint8Array(3))].join(".");

const resendEmailSchema = z.object({
  text: z.string(),
  to: z.array(z.string()),
});

const codes = new Map<string, string>();

export const createInvite = async ({
  expiresAt = Date.now() + 60_000,
  maxUses = 1,
} = {}) => {
  const code = crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 8)
    .toUpperCase();
  await env.DB.prepare(
    'INSERT INTO "inviteCode" ("code", "maxUses", "expiresAt") VALUES (?, ?, ?)'
  )
    .bind(code, maxUses, expiresAt)
    .run();
  return code;
};

export const useAuth = () => {
  beforeAll(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      if (request.url !== "https://api.resend.com/emails") {
        throw new Error("Unexpected network request");
      }
      const { text, to } = resendEmailSchema.parse(await request.json());
      const code = /\b(?<code>\d{6})\b/u.exec(text)?.groups?.["code"];
      if (code && to[0]) {
        codes.set(to[0], code);
      }
      return Response.json({ id: crypto.randomUUID() });
    });
  });
  afterAll(() => vi.restoreAllMocks());

  return async (
    email = `${crypto.randomUUID()}@memsys.test`,
    inviteCode?: string
  ): Promise<User> => {
    const client = { "cf-connecting-ip": randomIp() };
    const invite = { inviteCode: inviteCode ?? (await createInvite()) };
    await post(
      "/api/auth/email-otp/send-verification-otp",
      { email, type: "sign-in", ...invite },
      null,
      client
    );
    const signedIn = await post(
      "/api/auth/sign-in/email-otp",
      { email, otp: codes.get(email) ?? "", ...invite },
      null,
      client
    );
    if (!signedIn.ok) {
      throw new Error(`Sign-in failed: ${signedIn.status}`);
    }
    const { user } = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await signedIn.json());
    const cookie = signedIn.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    const created = await post(
      "/api/auth/api-key/create",
      { name: "test" },
      null,
      { ...client, Cookie: cookie, Origin: ORIGIN }
    );
    const { key } = await created.json<{ key: string }>();
    return { cookie, email, id: user.id, token: key };
  };
};

export const sentCode = (email: string) => codes.get(email);

export const memoryOf = (user: User) =>
  env.MEMORY.getByName(defaultSpace(user.id));

export const getList = (user: User | null, query = "") =>
  worker.fetch(
    new Request(`${ORIGIN}/api/fragments${query}`, {
      headers: credentials("/api", user),
    }),
    env
  );

export const withVersions = (item: Fragment, versions = 1): ListedFragment => ({
  ...item,
  versions,
});

export const list = async (user: User) => {
  const response = await getList(user);
  return response.json<FragmentPage>();
};

interface ToolResult {
  content: { text: string }[];
  isError?: boolean;
}

export const call = async (user: User, name: string, args: JSONValue) => {
  const response = await post(
    "/mcp",
    {
      id: 1,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: args, name },
    },
    user
  );
  const body = await response.json<{ result: ToolResult }>();
  return body.result;
};

export const content = <T>(result: ToolResult): T =>
  JSON.parse(result.content[0]?.text ?? "");

export const patchSettings = (user: User, patch: JSONValue) =>
  worker.fetch(
    new Request(`${ORIGIN}/api/settings`, {
      body: JSON.stringify(patch),
      headers: { "Content-Type": "application/json", Cookie: user.cookie },
      method: "PATCH",
    }),
    env
  );
