import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { authClient } from "@/shared/api";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

const MESSAGES = new Map([
  ["INVALID_OTP", "That code isn’t right. Check it and try again."],
  [
    "INVITE_CODE_UNUSABLE",
    "This invite expired or was used up. Ask the person who invited you for a new one.",
  ],
  [
    "NO_ACCOUNT",
    "No account uses this email. New here? Open your invite link or enter your invite code.",
  ],
  ["OTP_EXPIRED", "That code has expired. Send a new one."],
  [
    "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
    "Too many wrong codes. Send a new one.",
  ],
]);

const throwBetterAuthError = async (
  result: Promise<{
    error: {
      code?: string | undefined;
      message?: string | undefined;
      status: number;
    } | null;
  }>
) => {
  const { error } = await result;
  if (error) {
    throw new Error(
      (error.code ? MESSAGES.get(error.code) : undefined) ??
        (error.status === 429
          ? "Too many tries. Wait a minute and try again."
          : (error.message ?? "Something went wrong. Try again."))
    );
  }
};

const RESEND_DELAY = 60;

export const Problem = ({ text }: { text: string }) => (
  <Alert className="bg-amber-50 text-amber-950 ring-amber-300">
    <AlertDescription className="text-amber-950">{text}</AlertDescription>
  </Alert>
);

interface EmailCodeCardProps {
  belowEmailForm?: ReactNode;
  description: string;
  inviteCode?: string;
  onSignedIn?: () => void;
  pendingLabel: string;
  submitLabel: string;
  title: string;
}

export const EmailCodeCard = ({
  belowEmailForm,
  description,
  inviteCode,
  onSignedIn,
  pendingLabel,
  submitLabel,
  title,
}: EmailCodeCardProps) => {
  const invite = inviteCode === undefined ? {} : { inviteCode };
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const send = useMutation({
    mutationFn: (address: string) =>
      throwBetterAuthError(
        authClient.emailOtp.sendVerificationOtp({
          email: address,
          type: "sign-in",
          ...invite,
        })
      ),
    onSuccess: (_, address) => {
      setSentTo(address);
      setCode("");
      setCooldown(RESEND_DELAY);
    },
  });
  const verify = useMutation({
    mutationFn: (otp: string) =>
      throwBetterAuthError(
        authClient.signIn.emailOtp({ email: sentTo ?? "", otp, ...invite })
      ),
    onSuccess: () => onSignedIn?.(),
  });

  const error = (sentTo ? verify.error : null) ?? send.error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{sentTo ? "Check your email" : title}</CardTitle>
        <CardDescription>
          {sentTo
            ? `A 6-digit code is on its way to ${sentTo}. It expires in 5 minutes.`
            : description}
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
              {verify.isPending ? pendingLabel : submitLabel}
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
                disabled={send.isPending || cooldown > 0}
                onClick={() => {
                  verify.reset();
                  send.mutate(sentTo);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {send.isPending ? "Sending…" : "Send a new code"}
                {cooldown > 0 ? ` (${cooldown}s)` : null}
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
            <Button className="w-full" disabled={send.isPending} type="submit">
              {send.isPending ? "Sending…" : "Email me a code"}
            </Button>
            {belowEmailForm}
          </form>
        )}
      </CardContent>
    </Card>
  );
};
