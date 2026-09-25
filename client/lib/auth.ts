import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Sign-in and session state. Better Auth serves /api/auth on this origin and
// keeps the session in an HTTP-only cookie. During an app's OAuth sign-in,
// the OAuth plugin sends the page's signed query along, so signing in
// returns to the app.
export const authClient = createAuthClient({
  plugins: [emailOTPClient(), oauthProviderClient()],
});
