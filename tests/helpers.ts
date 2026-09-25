import { env } from "cloudflare:workers";
import type { JSONValue } from "hono/utils/types";
import { afterAll, beforeAll, vi } from "vitest";
import { z } from "zod";

import type { FragmentPage } from "../contract/memory";
import { defaultSpace, memoryOf as memoryOfSpace } from "../worker/auth";
import worker from "../worker/index";

export const ORIGIN = "https://memsys.test";

// A signed-in user: a browser session for /api, an API key for /mcp.
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

const resendEmail = z.object({ text: z.string(), to: z.array(z.string()) });

// Codes the worker sent through Resend, by recipient.
const codes = new Map<string, string>();

// Exercise real email sign-in; only the Resend request is mocked.
export const useAuth = () => {
  beforeAll(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      if (String(input) !== "https://api.resend.com/emails") {
        throw new Error("Unexpected network request");
      }
      const { text, to } = resendEmail.parse(JSON.parse(String(init?.body)));
      const code = /\b(?<code>\d{6})\b/u.exec(text)?.groups?.["code"];
      if (code && to[0]) {
        codes.set(to[0], code);
      }
      return Promise.resolve(Response.json({ id: crypto.randomUUID() }));
    });
  });
  afterAll(() => vi.restoreAllMocks());

  // Fresh users isolate memory; an explicit email signs the same user in again.
  return async (
    email = `${crypto.randomUUID()}@memsys.test`
  ): Promise<User> => {
    // Auth routes are rate limited per client address.
    const client = { "cf-connecting-ip": randomIp() };
    await post(
      "/api/auth/email-otp/send-verification-otp",
      { email, type: "sign-in" },
      null,
      client
    );
    const signedIn = await post(
      "/api/auth/sign-in/email-otp",
      { email, otp: codes.get(email) ?? "" },
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
  memoryOfSpace(env, defaultSpace(user.id));

export const getList = (user: User | null, query = "") =>
  worker.fetch(
    new Request(`${ORIGIN}/api/fragments${query}`, {
      headers: credentials("/api", user),
    }),
    env
  );

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
