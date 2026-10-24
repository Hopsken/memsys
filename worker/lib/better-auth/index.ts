import { apiKey } from "@better-auth/api-key";
import { cimd } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import { jwt } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins/email-otp";
import { z } from "zod";

import { sendSignInCode } from "../../clients/resend";

export const MEMORY_READ = "memory:read";
export const MEMORY_WRITE = "memory:write";
export type Scope = typeof MEMORY_READ | typeof MEMORY_WRITE;
export const ALL_SCOPES: ReadonlySet<Scope> = new Set([
  MEMORY_READ,
  MEMORY_WRITE,
]);
// Refresh tokens are issued only with offline_access; without it an app
// would need the user to sign in again every hour.
export const OAUTH_SCOPES = [MEMORY_READ, MEMORY_WRITE, "offline_access"];

export const mcpResource = (env: Env) => `${env.PUBLIC_URL}/mcp`;
export const resourceMetadataUrl = (env: Env) =>
  `${env.PUBLIC_URL}/.well-known/oauth-protected-resource/mcp`;
const issuer = (env: Env) => `${env.PUBLIC_URL}/api/auth`;

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

const mcpPlugin = (env: Env) =>
  // SAFETY: widening to the plugin id only drops the endpoint types, which
  // fail exactOptionalPropertyTypes; nothing here calls them via `auth.api`.
  mcp({
    allowDynamicClientRegistration: true,
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
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type === "sign-in" && isAllowedEmail(env, email)) {
            await sendSignInCode(email, otp);
          }
        },
        storeOTP: "hashed",
      }),
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
    rateLimit: {
      customRules: { "/get-session": false },
      enabled: true,
      storage: "database",
    },
    secret: env.BETTER_AUTH_SECRET,
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    telemetry: { enabled: false },
  });

interface Instance {
  auth: ReturnType<typeof createAuth>;
  createdAt: number;
  ready: boolean;
}

// Better Auth sets itself up with D1 queries as soon as it is created.
const SETUP_TIMEOUT_MS = 10_000;

const instances = new WeakMap<Env, Instance>();

// A failed setup is dropped, so the next request starts over. Setup ends
// with a schema check that Better Auth starts but does not wait for, and
// every request waits on it; so it is part of setup too.
const settle = async (env: Env, instance: Instance) => {
  try {
    const context = await instance.auth.$context;
    await context.checkSchema?.();
    instance.ready = true;
  } catch {
    if (instances.get(env) === instance) {
      instances.delete(env);
    }
  }
};

// Every request in an isolate waits on the shared instance's setup. That
// setup's I/O belongs to the request that started it: if that request is
// canceled, the setup never finishes and every later request hangs. So the
// starting request keeps it alive with waitUntil, and an instance still not
// ready after the timeout is replaced.
export const getAuth = (env: Env, ctx?: ExecutionContext) => {
  const cached = instances.get(env);
  if (
    cached &&
    (cached.ready || Date.now() - cached.createdAt < SETUP_TIMEOUT_MS)
  ) {
    return cached.auth;
  }
  const instance: Instance = {
    auth: createAuth(env),
    createdAt: Date.now(),
    ready: false,
  };
  const setup = settle(env, instance);
  ctx?.waitUntil(setup);
  instances.set(env, instance);
  return instance.auth;
};

const accessToken = z.object({
  azp: z.string(),
  cnf: z.unknown().optional(),
  scope: z.string().default(""),
  sub: z.string(),
});

const jwksCacheKeys = new WeakMap<Env, object>();

export const verifyAccessToken = async (env: Env, token: string) => {
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
  const client = await adapter.findOne<{ name?: string | null }>({
    model: "oauthClient",
    where: [{ field: "clientId", value: claims.data.azp }],
  });
  const granted = new Set(claims.data.scope.split(" "));
  return {
    name: client?.name ?? null,
    scopes: new Set([...ALL_SCOPES].filter((scope) => granted.has(scope))),
    userId: claims.data.sub,
  };
};
