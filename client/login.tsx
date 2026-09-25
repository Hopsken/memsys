import { useMutation } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth";

// Better Auth answers with `{ data, error }`; mutations want a thrown error.
const check = async (
  result: Promise<{ error: { message?: string | undefined } | null }>
) => {
  const { error } = await result;
  if (error) {
    throw new Error(error.message ?? "Something went wrong.");
  }
};

const Problem = ({ text }: { text: string }) => (
  <Alert className="bg-amber-50 text-amber-950 ring-amber-300">
    <AlertDescription className="text-amber-950">{text}</AlertDescription>
  </Alert>
);

export const LoginView = () => {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: (address: string) =>
      check(
        authClient.emailOtp.sendVerificationOtp({
          email: address,
          type: "sign-in",
        })
      ),
    onSuccess: (_, address) => {
      setSentTo(address);
      setCode("");
    },
  });
  const verify = useMutation({
    mutationFn: (otp: string) =>
      check(authClient.signIn.emailOtp({ email: sentTo ?? "", otp })),
    onSuccess: () => navigate("/", { replace: true }),
  });

  if (session.data && !verify.isPending) {
    return <Navigate replace to="/" />;
  }

  const error = (sentTo ? verify.error : null) ?? send.error;

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 px-5 py-10">
      <h1 className="flex items-center justify-center gap-3 text-3xl font-semibold tracking-tight">
        <Layers aria-hidden="true" className="size-7" />
        memsys
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>{sentTo ? "Check your email" : "Sign in"}</CardTitle>
          <CardDescription>
            {sentTo
              ? `If ${sentTo} may sign in, a 6-digit code is on its way. It expires in 5 minutes.`
              : "We will email you a one-time code."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sentTo ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                verify.mutate(code.trim());
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="code">Code</Label>
                <Input
                  autoComplete="one-time-code"
                  autoFocus
                  className="font-mono tracking-[0.3em]"
                  id="code"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setCode(event.target.value)}
                  pattern="[0-9]{6}"
                  required
                  value={code}
                />
              </div>
              {error ? <Problem text={error.message} /> : null}
              <Button
                className="w-full"
                disabled={verify.isPending || code.trim().length !== 6}
                type="submit"
              >
                {verify.isPending ? "Signing in…" : "Sign in"}
              </Button>
              <div className="flex justify-between gap-2">
                <Button
                  onClick={() => {
                    setSentTo(null);
                    verify.reset();
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Use another email
                </Button>
                <Button
                  disabled={send.isPending}
                  onClick={() => {
                    verify.reset();
                    send.mutate(sentTo);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {send.isPending ? "Sending…" : "Send a new code"}
                </Button>
              </div>
            </form>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                send.mutate(email.trim());
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  autoComplete="email"
                  autoFocus
                  id="email"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </div>
              {error ? <Problem text={error.message} /> : null}
              <Button
                className="w-full"
                disabled={send.isPending}
                type="submit"
              >
                {send.isPending ? "Sending…" : "Email me a code"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
};
