import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Sign-in and session state. Better Auth serves /api/auth on this origin and
// keeps the session in an HTTP-only cookie.
export const authClient = createAuthClient({ plugins: [emailOTPClient()] });
