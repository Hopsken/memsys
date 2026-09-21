import { env } from "cloudflare:workers";
import type { JSONValue } from "hono/utils/types";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";

import worker from "../worker/index";
import type { FragmentPage } from "../worker/memory";

// Exercise real Access verification; only the remote signing-key lookup is mocked.
export const useAccess = () => {
  let privateKey: CryptoKey;
  let scope: string;
  // The Workers pool retains DO storage between tests. Scope identities per test.
  beforeEach(() => {
    scope = crypto.randomUUID();
  });
  beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    ({ privateKey } = pair);
    const key = await exportJWK(pair.publicKey);
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (String(url) !== `${env.ACCESS_ISSUER}/cdn-cgi/access/certs`) {
        throw new Error("Unexpected network request");
      }
      return Promise.resolve(
        Response.json({
          keys: [{ ...key, alg: "RS256", kid: "test-key", use: "sig" }],
        })
      );
    });
  });
  afterAll(() => vi.restoreAllMocks());

  return (
    subject: string,
    claims: Record<string, JSONValue | undefined> = {},
    key = privateKey
  ) =>
    new SignJWT({
      aud: env.ACCESS_AUD,
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000),
      iss: env.ACCESS_ISSUER,
      sub: `${scope}:${subject}`,
      type: "app",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .sign(key);
};

export const post = (
  path: string,
  body: JSONValue,
  jwt: string,
  headers: Record<string, string> = {}
) =>
  worker.fetch(
    new Request(`https://memsys.test${path}`, {
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json, text/event-stream",
        "Cf-Access-Jwt-Assertion": jwt,
        "Content-Type": "application/json",
        ...headers,
      },
      method: "POST",
    }),
    env
  );

export const getList = (jwt: string, query = "") =>
  worker.fetch(
    new Request(`https://memsys.test/api/fragments${query}`, {
      headers: { "Cf-Access-Jwt-Assertion": jwt },
    }),
    env
  );

export const list = async (jwt: string) => {
  const response = await getList(jwt);
  return response.json<FragmentPage>();
};

interface ToolResult {
  content: { text: string }[];
  isError?: boolean;
}

export const call = async (jwt: string, name: string, args: JSONValue) => {
  const response = await post(
    "/mcp",
    {
      id: 1,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: args, name },
    },
    jwt
  );
  const body = await response.json<{ result: ToolResult }>();
  return body.result;
};

export const content = <T>(result: ToolResult): T =>
  JSON.parse(result.content[0]?.text ?? "");
