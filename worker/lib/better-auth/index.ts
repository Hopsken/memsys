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

const signInCodeRequestSchema = z.object({
  email: z.string(),
  type: z.literal("sign-in"),
});

const clientRegistrationSchema = z.looseObject({
  application_type: z.string().optional(),
  redirect_uris: z.array(z.string()).min(1),
});

const authorizationRequestSchema = z.looseObject({ scope: z.string() });

interface BeforeHookOverride {
  context:
    | { body: z.output<typeof clientRegistrationSchema> }
    | { query: z.output<typeof authorizationRequestSchema> };
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

const registerLoopbackOnlyAppsAsNative = (
  path: string,
  client: z.output<typeof clientRegistrationSchema> | undefined
): BeforeHookOverride | null => {
  if (
    path !== "/oauth2/register" ||
    !client ||
    client.application_type !== undefined ||
    !client.redirect_uris.every(isNativeRedirect)
  ) {
    return null;
  }
  return { context: { body: { ...client, application_type: "native" } } };
};

const requestRefreshTokensForEveryApp = (
  path: string,
  authorization: z.output<typeof authorizationRequestSchema> | undefined
): BeforeHookOverride | null => {
  if (
    path !== "/oauth2/authorize" ||
    !authorization ||
    authorization.scope.split(" ").includes("offline_access")
  ) {
    return null;
  }
  return {
    context: {
      query: {
        ...authorization,
        scope: `${authorization.scope} offline_access`,
      },
    },
  };
};

const refuseSignInCodesToUnlistedEmails = (
  env: Env,
  path: string,
  request: z.output<typeof signInCodeRequestSchema> | undefined
) => {
  if (
    path === "/email-otp/send-verification-otp" &&
    request &&
    !isAllowedEmail(env, request.email)
  ) {
    throw new APIError("FORBIDDEN", {
      message: "This email is not allowed to sign in.",
    });
  }
};

const isPublicHttpsHost = ({ hostname, protocol }: URL) =>
  protocol === "https:" &&
  hostname !== "localhost" &&
  !hostname.startsWith("[") &&
  !/^[\d.]+$/u.test(hostname);

const fetchClientMetadataFromPublicHttps: ClientMetadataResourceFetch = (
  input,
  init
) => {
  const redirectsReturnedAsResponses = "manual";
  const request = new Request(input, {
    ...init,
    redirect: redirectsReturnedAsResponses,
  });
  if (!isPublicHttpsHost(new URL(request.url))) {
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
      before: createAuthMiddleware(
        (ctx): Promise<BeforeHookOverride | null> => {
          refuseSignInCodesToUnlistedEmails(
            env,
            ctx.path,
            signInCodeRequestSchema.safeParse(ctx.body).data
          );
          return Promise.resolve(
            registerLoopbackOnlyAppsAsNative(
              ctx.path,
              clientRegistrationSchema.safeParse(ctx.body).data
            ) ??
              requestRefreshTokensForEveryApp(
                ctx.path,
                authorizationRequestSchema.safeParse(ctx.query).data
              )
          );
        }
      ),
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
        fetchClientMetadataResource: fetchClientMetadataFromPublicHttps,
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

const SETUP_TIMEOUT_MS = 10_000;

const instances = new WeakMap<Env, Instance>();

const finishSetupIncludingSchemaCheck = async (
  env: Env,
  instance: Instance
) => {
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

const isStalled = (instance: Instance) =>
  !instance.ready && Date.now() - instance.createdAt >= SETUP_TIMEOUT_MS;

export const getAuth = (env: Env, ctx?: ExecutionContext) => {
  const cached = instances.get(env);
  if (cached && !isStalled(cached)) {
    return cached.auth;
  }
  const instance: Instance = {
    auth: createAuth(env),
    createdAt: Date.now(),
    ready: false,
  };
  const setupOutlivingItsRequest = finishSetupIncludingSchemaCheck(
    env,
    instance
  );
  ctx?.waitUntil(setupOutlivingItsRequest);
  instances.set(env, instance);
  return instance.auth;
};

const accessTokenSchema = z.object({
  azp: z.string(),
  cnf: z.unknown().optional(),
  scope: z.string().default(""),
  sub: z.string(),
});

const jwksCacheKeys = new WeakMap<Env, object>();

export const verifyAccessToken = async (env: Env, token: string) => {
  const auth = getAuth(env);
  const readJwksInProcess = () => auth.api.getJwks();
  let jwksCacheKey = jwksCacheKeys.get(env);
  if (!jwksCacheKey) {
    jwksCacheKey = {};
    jwksCacheKeys.set(env, jwksCacheKey);
  }
  const payload = await verifyJwsAccessToken(token, {
    jwksCacheKey,
    jwksFetch: readJwksInProcess,
    verifyOptions: { audience: mcpResource(env), issuer: issuer(env) },
  }).catch(() => null);
  const claims = accessTokenSchema.safeParse(payload);
  const isSenderConstrained = claims.data?.cnf !== undefined;
  if (!claims.success || isSenderConstrained) {
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
