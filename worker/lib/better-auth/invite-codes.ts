import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
} from "better-auth/api";
import { z } from "zod";

const signUpRequestSchema = z.looseObject({
  email: z.string(),
  inviteCode: z.string().optional(),
});

const checkQuerySchema = z.object({ code: z.string().max(64) });

const noAccount = () =>
  new APIError("FORBIDDEN", {
    code: "NO_ACCOUNT",
    message: "No account uses this email.",
  });

const unusableInvite = () =>
  new APIError("FORBIDDEN", {
    code: "INVITE_CODE_UNUSABLE",
    message: "This invite expired or was used up.",
  });

const normalize = (code: string) =>
  code.toUpperCase().replaceAll(/[^0-9A-Z]/gu, "");

const isUsable = async (db: D1Database, code: string) =>
  (await db
    .prepare(
      'SELECT 1 FROM "inviteCode" WHERE "code" = ? AND "uses" < "maxUses" AND "expiresAt" > ?'
    )
    .bind(normalize(code), Date.now())
    .first()) !== null;

const useOnce = async (db: D1Database, code: string) =>
  (await db
    .prepare(
      'UPDATE "inviteCode" SET "uses" = "uses" + 1 WHERE "code" = ? AND "uses" < "maxUses" AND "expiresAt" > ? RETURNING 1'
    )
    .bind(normalize(code), Date.now())
    .first()) !== null;

export const inviteCodes = (db: D1Database) =>
  ({
    endpoints: {
      checkInviteCode: createAuthEndpoint(
        "/invite-code/check",
        { method: "GET", query: checkQuerySchema },
        async (ctx) => ctx.json({ usable: await isUsable(db, ctx.query.code) })
      ),
    },
    hooks: {
      before: [
        {
          handler: createAuthMiddleware(async (ctx) => {
            const request = signUpRequestSchema.safeParse(ctx.body).data;
            if (
              !request ||
              (await ctx.context.internalAdapter.findUserByEmail(
                request.email.trim().toLowerCase()
              ))
            ) {
              return;
            }
            if (request.inviteCode === undefined) {
              throw noAccount();
            }
            if (!(await isUsable(db, request.inviteCode))) {
              throw unusableInvite();
            }
          }),
          matcher: (ctx) => ctx.path === "/email-otp/send-verification-otp",
        },
      ],
    },
    id: "invite-codes",
    init: () => ({
      options: {
        databaseHooks: {
          user: {
            create: {
              before: async (_user, ctx) => {
                const code = signUpRequestSchema.safeParse(ctx?.body).data
                  ?.inviteCode;
                if (code === undefined || !(await useOnce(db, code))) {
                  throw unusableInvite();
                }
              },
            },
          },
        },
      },
    }),
    rateLimit: [
      {
        max: 10,
        pathMatcher: (path) => path === "/invite-code/check",
        window: 60,
      },
    ],
  }) satisfies BetterAuthPlugin;
