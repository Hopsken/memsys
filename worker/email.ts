// Sends the sign-in code through Resend. Dev builds without a key print it.
export const sendSignInCode = async (env: Env, email: string, code: string) => {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    if (import.meta.env.DEV) {
      console.log(`[auth] Sign-in code for ${email}: ${code}`);
      return;
    }
    throw new Error("RESEND_API_KEY and EMAIL_FROM must be configured");
  }
  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      subject: `${code} is your memsys sign-in code`,
      text: `Your memsys sign-in code is ${code}. It expires in 5 minutes.\n\nIf you did not try to sign in, ignore this email.`,
      to: [email],
    }),
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Resend rejected the email: ${response.status}`);
  }
};
