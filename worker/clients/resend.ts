import { env } from "cloudflare:workers";
import ky, { isHTTPError } from "ky";
import { z } from "zod";

// Resend also answers 429 when a quota is spent; asking again cannot help
// until the quota resets.
const QUOTA_ERRORS = new Set([
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
]);
const resendErrorSchema = z.object({ name: z.string() });

const isQuotaError = (error: Error) =>
  isHTTPError(error) &&
  QUOTA_ERRORS.has(resendErrorSchema.safeParse(error.data).data?.name ?? "");

export const sendSignInCode = async (email: string, code: string) => {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    if (import.meta.env.DEV) {
      console.log(`[auth] Sign-in code for ${email}: ${code}`);
      return;
    }
    throw new Error("RESEND_API_KEY and EMAIL_FROM must be configured");
  }
  await ky.post("https://api.resend.com/emails", {
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      // Every retry sends the same key, so Resend sends the email only once.
      "Idempotency-Key": crypto.randomUUID(),
    },
    json: {
      from: env.EMAIL_FROM,
      subject: `${code} is your memsys sign-in code`,
      text: `Your memsys sign-in code is ${code}. It expires in 5 minutes.\n\nIf you did not try to sign in, ignore this email.`,
      to: [email],
    },
    retry: {
      limit: 2,
      maxRetryAfter: 5000,
      methods: ["post"],
      shouldRetry: ({ error }) => (isQuotaError(error) ? false : undefined),
    },
  });
};
