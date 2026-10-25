import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";

import { EmailCodeCard, Problem } from "@/features/auth";
import { authClient, http } from "@/shared/api";
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
import { Logo } from "@/shared/ui/logo";

const EnterCode = () => {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Join memsys</CardTitle>
        <CardDescription>Enter the invite code you got.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void navigate(`/join/${encodeURIComponent(code.trim())}`);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="invite-code">Invite code</Label>
            <Input
              autoCapitalize="characters"
              autoComplete="off"
              autoFocus
              className="font-mono tracking-[0.2em] uppercase"
              id="invite-code"
              onChange={(event) => setCode(event.target.value)}
              placeholder="XXXX-XXXX"
              required
              value={code}
            />
          </div>
          <Button className="w-full" disabled={!code.trim()} type="submit">
            Continue
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

const Invite = ({ code }: { code: string }) => {
  const navigate = useNavigate();
  const check = useQuery({
    queryFn: () =>
      http
        .get("/api/auth/invite-code/check", { searchParams: { code } })
        .json<{ usable: boolean }>(),
    queryKey: ["invite-code", code],
    retry: false,
  });

  if (check.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Checking your invite…</CardTitle>
        </CardHeader>
      </Card>
    );
  }
  if (check.isError) {
    return (
      <Problem text="We couldn’t check this invite. Wait a minute and reload the page." />
    );
  }
  if (!check.data.usable) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>This invite doesn’t work anymore</CardTitle>
          <CardDescription>
            It expired or was used up. Ask the person who invited you for a new
            one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" render={<Link to="/join" />}>
            Enter another code
          </Button>
        </CardContent>
      </Card>
    );
  }
  return (
    <EmailCodeCard
      description="Enter your email. We’ll send you a code to create your account."
      inviteCode={code}
      onSignedIn={() => navigate("/", { replace: true })}
      pendingLabel="Creating account…"
      submitLabel="Create account"
      title="You’re invited to memsys"
    />
  );
};

const Screen = ({ children }: { children: ReactNode }) => (
  <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 px-5 py-10">
    <h1 className="flex items-center justify-center gap-3 text-3xl font-semibold tracking-tight">
      <Logo className="size-10" />
      memsys
    </h1>
    {children}
    <p className="text-muted-foreground text-center text-sm">
      Already have an account?{" "}
      <Link
        className="text-foreground underline underline-offset-4"
        to="/login"
      >
        Sign in
      </Link>
    </p>
  </main>
);

export const JoinView = () => {
  const { code } = useParams();
  const session = authClient.useSession();

  if (session.data) {
    return <Navigate replace to="/" />;
  }

  return (
    <Screen>{code ? <Invite code={code} key={code} /> : <EnterCode />}</Screen>
  );
};
