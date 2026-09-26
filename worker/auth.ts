import { apiKey } from "@better-auth/api-key";
import { cimd } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import { jwt } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins/email-otp";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";

import { sendSignInCode } from "./email";
import type { MemoryDO } from "./memory-do";

// What an MCP caller may do. API keys may do both.
export const MEMORY_READ = "memory:read";
export const MEMORY_WRITE = "memory:write";
export type Scope = typeof MEMORY_READ | typeof MEMORY_WRITE;
const ALL_SCOPES: ReadonlySet<Scope> = new Set([MEMORY_READ, MEMORY_WRITE]);
// Refresh tokens are issued only with offline_access; without it an app
// would need the user to sign in again every hour.
const OAUTH_SCOPES = [MEMORY_READ, MEMORY_WRITE, "offline_access"];

export interface AppEnv {
  Bindings: Env;
  Variables: {
    memory: DurableObjectStub<MemoryDO>;
    scopes: ReadonlySet<Scope>;
    userId: string;
  };
}

// The /mcp URL is the OAuth resource: tokens name it as their audience.
export const mcpResource = (env: Env) => `${env.PUBLIC_URL}/mcp`;
const resourceMetadataUrl = (env: Env) =>
  `${env.PUBLIC_URL}/.well-known/oauth-protected-resource/mcp`;
const issuer = (env: Env) => `${env.PUBLIC_URL}/api/auth`;

// AUTH_ALLOWED_EMAILS: comma- or space-separated addresses, or `@domain`.
export const isAllowedEmail = (env: Env, email: string) => {
  const address = email.trim().toLowerCase();
  return (env.AUTH_ALLOWED_EMAILS ?? "")
    .toLowerCase()
    .split(/[\s,]+/u)
    .some(
      (entry) =>
        entry !== "" &&
        (entry.startsWith("@") ? address.endsWith(entry) : address === entry)
    );
};

const signInCodeRequest = z.object({
  email: z.string(),
  type: z.literal("sign-in"),
});

// Loose, so the rest of the registration passes through untouched.
const clientRegistration = z.looseObject({
  application_type: z.string().optional(),
  redirect_uris: z.array(z.string()).min(1),
});

const authorizationRequest = z.looseObject({ scope: z.string() });

// A before hook may replace the body or query the endpoint sees.
interface RequestOverride {
  context:
    | { body: z.output<typeof clientRegistration> }
    | { query: z.output<typeof authorizationRequest> };
}

// A redirect back to an app on the user's machine: a loopback address or
// the app's own URL scheme.
const isNativeRedirect = (uri: string) => {
  const url = URL.parse(uri);
  if (!url) {
    return false;
  }
  if (url.protocol === "http:") {
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  }
  return url.protocol !== "https:";
};

// Fetches an app's client metadata document (CIMD). Better Auth's transport
// is Node-only; on Workers, fetch cannot reach private networks, so this
// refuses the rest: plain HTTP, IP literals, localhost, and redirects.
// Better Auth asks for redirect "error", which Workers rejects; "manual"
// hands a redirect back as a 3xx, which Better Auth then refuses.
const fetchClientMetadata: ClientMetadataResourceFetch = (input, init) => {
  const request = new Request(input, { ...init, redirect: "manual" });
  const { hostname, protocol } = new URL(request.url);
  if (
    protocol !== "https:" ||
    hostname === "localhost" ||
    hostname.startsWith("[") ||
    /^[\d.]+$/u.test(hostname)
  ) {
    throw new TypeError("Client metadata must be on a public HTTPS host");
  }
  return fetch(request, { signal: init?.signal ?? AbortSignal.timeout(5000) });
};

// OAuth for /mcp: apps sign the user in instead of holding a key.
const mcpPlugin = (env: Env) =>
  // SAFETY: widening to the plugin id only drops the endpoint types, which
  // fail exactOptionalPropertyTypes; nothing here calls them via `auth.api`.
  mcp({
    // Apps that predate client metadata documents register themselves;
    // each still needs a signed-in user's consent.
    allowDynamicClientRegistration: true,
    // The sign-in page names the app before the user has a session.
    allowPublicClientPrelogin: true,
    allowUnauthenticatedClientRegistration: true,
    clientRegistrationDefaultScopes: OAUTH_SCOPES,
    consentPage: "/consent",
    loginPage: "/login",
    resource: mcpResource(env),
    scopes: OAUTH_SCOPES,
  }) as { id: "oauth-provider" };

const createAuth = (env: Env) =>
  betterAuth({
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    basePath: "/api/auth",
    baseURL: env.PUBLIC_URL,
    database: env.DB,
    databaseHooks: {
      user: {
        create: {
          // Sign-in creates the account, so the allowlist is enforced here too.
          before: (user) => {
            if (!isAllowedEmail(env, user.email)) {
              throw new APIError("FORBIDDEN", {
                message: "Sign-in not allowed",
              });
            }
            return Promise.resolve();
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware((ctx): Promise<RequestOverride | null> => {
        // Desktop MCP apps register loopback redirects without saying they
        // are native apps, and web apps may not use http://localhost.
        const client = clientRegistration.safeParse(ctx.body);
        if (
          ctx.path === "/oauth2/register" &&
          client.success &&
          client.data.application_type === undefined &&
          client.data.redirect_uris.every(isNativeRedirect)
        ) {
          return Promise.resolve({
            context: { body: { ...client.data, application_type: "native" } },
          });
        }
        // Apps such as ChatGPT ask only for the scopes /mcp lists, which
        // leave out offline_access, and so would get no refresh token and
        // need the user to sign in again every hour. Ask for it on their
        // behalf; only apps registered for refresh tokens receive one.
        const authorization = authorizationRequest.safeParse(ctx.query);
        if (
          ctx.path === "/oauth2/authorize" &&
          authorization.success &&
          !authorization.data.scope.split(" ").includes("offline_access")
        ) {
          return Promise.resolve({
            context: {
              query: {
                ...authorization.data,
                scope: `${authorization.data.scope} offline_access`,
              },
            },
          });
        }
        // Tell an address outside the allowlist so, before any code is stored.
        const request = signInCodeRequest.safeParse(ctx.body);
        if (
          ctx.path === "/email-otp/send-verification-otp" &&
          request.success &&
          !isAllowedEmail(env, request.data.email)
        ) {
          throw new APIError("FORBIDDEN", {
            message: "This email is not allowed to sign in.",
          });
        }
        return Promise.resolve(null);
      }),
    },
    plugins: [
      emailOTP({
        // Codes go only to allowed addresses.
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type === "sign-in" && isAllowedEmail(env, email)) {
            await sendSignInCode(env, email, otp);
          }
        },
        storeOTP: "hashed",
      }),
      // API keys for /mcp. A key never stands in for a session, so it cannot reach
      // /api: plugin configuration and token management stay with the user.
      apiKey({
        defaultPrefix: "memsys_",
        enableSessionForAPIKeys: false,
        maximumNameLength: 64,
        rateLimit: { enabled: false },
        requireName: true,
        startingCharactersConfig: { charactersLength: 11 },
      }),
      jwt({ disableSettingJwtHeader: true }),
      mcpPlugin(env),
      cimd({
        fetchClientMetadataResource: fetchClientMetadata,
        metadataProfile: "mcp-2026-07-28",
      }),
    ],
    rateLimit: { enabled: true, storage: "database" },
    secret: env.BETTER_AUTH_SECRET,
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    telemetry: { enabled: false },
  });

// Bindings are fixed per deployment; reuse one instance per env object.
const instances = new WeakMap<Env, ReturnType<typeof createAuth>>();

export const getAuth = (env: Env) => {
  let auth = instances.get(env);
  if (!auth) {
    auth = createAuth(env);
    instances.set(env, auth);
  }
  return auth;
};

// A memory space id names one memory object. Each user has a default space
// whose id is their user id; this is the only place that ties the two, so
// more spaces per user, or another sign-in system, change only this.
export const defaultSpace = (userId: string) => userId;

export const memoryOf = (env: Env, spaceId: string) =>
  env.MEMORY.getByName(spaceId);

// Points apps without a token to OAuth sign-in (RFC 9728).
const unauthorized = (c: Context<AppEnv>) => {
  c.header(
    "WWW-Authenticate",
    `Bearer resource_metadata="${resourceMetadataUrl(c.env)}", scope="${OAUTH_SCOPES.join(" ")}"`
  );
  return c.json({ error: "Authentication required" }, 401);
};

// The web UI and /api: a signed-in browser session.
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const result = await getAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!result) {
    return c.json({ error: "Authentication required" }, 401);
  }
  c.set("memory", memoryOf(c.env, defaultSpace(result.user.id)));
  c.set("userId", result.user.id);
  return next();
});

const accessToken = z.object({
  azp: z.string(),
  cnf: z.unknown().optional(),
  scope: z.string().default(""),
  sub: z.string(),
});

// Signing keys, cached per env object like the auth instance.
const jwksCacheKeys = new WeakMap<Env, object>();

// An OAuth access token for /mcp: signed by us, for /mcp, and from an app
// the user has not disconnected since.
const verifyAccessToken = async (env: Env, token: string) => {
  const auth = getAuth(env);
  let jwksCacheKey = jwksCacheKeys.get(env);
  if (!jwksCacheKey) {
    jwksCacheKey = {};
    jwksCacheKeys.set(env, jwksCacheKey);
  }
  const payload = await verifyJwsAccessToken(token, {
    jwksCacheKey,
    // Read the keys in-process; fetching our own /jwks URL is a subrequest
    // to this Worker.
    jwksFetch: () => auth.api.getJwks(),
    verifyOptions: { audience: mcpResource(env), issuer: issuer(env) },
  }).catch(() => null);
  const claims = accessToken.safeParse(payload);
  // Sender-constrained (DPoP) tokens are refused; /mcp checks bearers only.
  if (!claims.success || claims.data.cnf !== undefined) {
    return null;
  }
  const { adapter } = await auth.$context;
  const consent = await adapter.findOne({
    model: "oauthConsent",
    where: [
      { field: "userId", value: claims.data.sub },
      { field: "clientId", value: claims.data.azp },
    ],
  });
  if (!consent) {
    return null;
  }
  const granted = new Set(claims.data.scope.split(" "));
  return {
    scopes: new Set([...ALL_SCOPES].filter((scope) => granted.has(scope))),
    userId: claims.data.sub,
  };
};

// /mcp: an API key or an OAuth access token as a bearer token,
// naming the user who created it.
export const requireToken = createMiddleware<AppEnv>(async (c, next) => {
  const key = /^Bearer\s+(?<key>\S+)$/iu.exec(
    c.req.header("Authorization") ?? ""
  )?.groups?.["key"];
  if (!key) {
    return unauthorized(c);
  }
  if (key.startsWith("memsys_")) {
    const verified = await getAuth(c.env).api.verifyApiKey({ body: { key } });
    if (!verified.valid || !verified.key) {
      return unauthorized(c);
    }
    c.set("memory", memoryOf(c.env, defaultSpace(verified.key.referenceId)));
    c.set("scopes", ALL_SCOPES);
    c.set("userId", verified.key.referenceId);
    return next();
  }
  const verified = await verifyAccessToken(c.env, key);
  if (!verified) {
    return unauthorized(c);
  }
  if (verified.scopes.size === 0) {
    c.header(
      "WWW-Authenticate",
      `Bearer error="insufficient_scope", scope="${[...ALL_SCOPES].join(" ")}", resource_metadata="${resourceMetadataUrl(c.env)}"`
    );
    return c.json({ error: "Insufficient scope" }, 403);
  }
  c.set("memory", memoryOf(c.env, defaultSpace(verified.userId)));
  c.set("scopes", verified.scopes);
  c.set("userId", verified.userId);
  return next();
});
