import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import worker from "../worker/index";
import { ORIGIN, post, randomIp, useAuth } from "./helpers";
import type { User } from "./helpers";

const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT_URI = "http://127.0.0.1:33418/callback";

const request = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`${ORIGIN}${path}`, init), env);

const base64Url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCodePoint(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

const register = async () => {
  const response = await request("/api/auth/oauth2/register", {
    body: JSON.stringify({
      client_name: "Test agent",
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
    }),
    // Registration is rate limited per client address.
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": randomIp(),
    },
    method: "POST",
  });
  expect(response.status).toBe(201);
  return z.object({ client_id: z.string() }).parse(await response.json())
    .client_id;
};

const redirect = z.object({ url: z.string() });

// The authorization code flow an MCP app runs, with the user allowing
// `granted` on the consent page, which always keeps the app signed in.
const authorize = async (user: User, clientId: string, granted: string) => {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  );
  const query = new URLSearchParams({
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
    response_type: "code",
    scope: "memory:read memory:write offline_access",
    state: "state-1",
  });
  const authorized = await request(`/api/auth/oauth2/authorize?${query}`, {
    headers: { Cookie: user.cookie },
    redirect: "manual",
  });
  const consentPage = new URL(authorized.headers.get("Location") ?? "", ORIGIN);
  expect(consentPage.pathname).toBe("/consent");
  const consented = await post(
    "/api/auth/oauth2/consent",
    {
      accept: true,
      oauth_query: consentPage.search.slice(1),
      scope: `${granted} offline_access`,
    },
    null,
    { Cookie: user.cookie, Origin: ORIGIN, "cf-connecting-ip": randomIp() }
  );
  expect(consented.status).toBe(200);
  const callback = new URL(redirect.parse(await consented.json()).url);
  expect(callback.searchParams.get("state")).toBe("state-1");
  const token = await request("/api/auth/oauth2/token", {
    body: new URLSearchParams({
      client_id: clientId,
      code: callback.searchParams.get("code") ?? "",
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      resource: RESOURCE,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  expect(token.status).toBe(200);
  return z
    .object({
      access_token: z.string(),
      refresh_token: z.string(),
      scope: z.string(),
    })
    .parse(await token.json());
};

const mcp = (accessToken: string, method: string, params = {}) =>
  request("/mcp", {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

const toolNames = async (accessToken: string) => {
  const response = await mcp(accessToken, "tools/list");
  const { result } = await response.json<{
    result: { tools: { name: string }[] };
  }>();
  return result.tools.map((tool) => tool.name).toSorted();
};

describe("OAuth for MCP", () => {
  const signIn = useAuth();

  it("points apps without a token to sign-in", async () => {
    const response = await request("/mcp", {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="memory:read memory:write offline_access"`
    );
    const resource = await request(
      "/.well-known/oauth-protected-resource/mcp",
      { headers: { Origin: "https://app.example" } }
    );
    expect(resource.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(resource.json()).resolves.toMatchObject({
      authorization_servers: [`${ORIGIN}/api/auth`],
      resource: RESOURCE,
      scopes_supported: ["memory:read", "memory:write"],
    });
    const server = await request(
      "/.well-known/oauth-authorization-server/api/auth"
    );
    await expect(server.json()).resolves.toMatchObject({
      authorization_endpoint: `${ORIGIN}/api/auth/oauth2/authorize`,
      issuer: `${ORIGIN}/api/auth`,
      registration_endpoint: `${ORIGIN}/api/auth/oauth2/register`,
      token_endpoint: `${ORIGIN}/api/auth/oauth2/token`,
    });
  });

  it("gives an app only the tools the user allowed", async () => {
    const user = await signIn();
    const clientId = await register();
    const readOnly = await authorize(user, clientId, "memory:read");
    await expect(toolNames(readOnly.access_token)).resolves.toStrictEqual([
      "list_tags",
      "recall",
    ]);
    const both = await authorize(
      user,
      await register(),
      "memory:read memory:write"
    );
    await expect(toolNames(both.access_token)).resolves.toStrictEqual([
      "forget",
      "list_tags",
      "recall",
      "remember",
      "revise",
    ]);
    const remembered = await mcp(both.access_token, "tools/call", {
      arguments: { fragment: "Signed in with OAuth #oauth" },
      name: "remember",
    });
    expect(remembered.status).toBe(200);
    const list = await request("/api/fragments", {
      headers: { Cookie: user.cookie },
    });
    await expect(list.json()).resolves.toMatchObject({
      fragments: [{ fragment: "Signed in with OAuth #oauth" }],
    });
  });

  it("disconnects an app at once", async () => {
    const user = await signIn();
    const clientId = await register();
    const tokens = await authorize(user, clientId, "memory:read memory:write");
    const listed = await request("/api/connections", {
      headers: { Cookie: user.cookie },
    });
    const connections = z
      .array(z.object({ id: z.string(), name: z.string().nullable() }))
      .parse(await listed.json());
    expect(connections).toMatchObject([{ name: "Test agent" }]);
    const removed = await request(`/api/connections/${connections[0]?.id}`, {
      headers: { Cookie: user.cookie },
      method: "DELETE",
    });
    expect(removed.status).toBe(204);
    await expect(mcp(tokens.access_token, "tools/list")).resolves.toMatchObject(
      { status: 401 }
    );
    const refreshed = await request("/api/auth/oauth2/token", {
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    expect(refreshed.ok).toBeFalsy();
  });

  it("keeps each user's connections to themselves", async () => {
    const owner = await signIn();
    const other = await signIn();
    await authorize(owner, await register(), "memory:read");
    const listed = await request("/api/connections", {
      headers: { Cookie: owner.cookie },
    });
    const [connection] = z
      .array(z.object({ id: z.string() }))
      .parse(await listed.json());
    const removed = await request(`/api/connections/${connection?.id}`, {
      headers: { Cookie: other.cookie },
      method: "DELETE",
    });
    expect(removed.status).toBe(404);
  });

  it("refuses tokens for another resource or a forged signature", async () => {
    await expect(
      mcp("eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.", "tools/list")
    ).resolves.toMatchObject({ status: 401 });
  });
});
