import { cn } from "cn";
import { Link, Navigate, useNavigate } from "react-router";

import { EmailCodeCard, useConnectingApp } from "@/features/auth";
import { authClient } from "@/shared/api";
import { buttonVariants } from "@/shared/ui/button";
import { Logo } from "@/shared/ui/logo";

const DEV_EMAIL = "dev@memsys.test";

const DevSignIn = () =>
  import.meta.env.DEV ? (
    <a
      className={cn(buttonVariants({ variant: "outline" }), "w-full")}
      href={`/__dev/log-me-in/${DEV_EMAIL}?returnTo=/`}
    >
      Sign in as {DEV_EMAIL}
    </a>
  ) : null;

export const LoginView = () => {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const app = useConnectingApp();
  const { forApp } = app;

  if (session.data && !forApp) {
    return <Navigate replace to="/" />;
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 px-5 py-10">
      <h1 className="flex items-center justify-center gap-3 text-3xl font-semibold tracking-tight">
        <Logo className="size-10" />
        memsys
      </h1>
      <EmailCodeCard
        belowEmailForm={forApp ? null : <DevSignIn />}
        description="We’ll email you a code to sign in."
        onSignedIn={() =>
          forApp ? undefined : navigate("/", { replace: true })
        }
        pendingLabel="Signing in…"
        submitLabel="Sign in"
        title={
          forApp && !app.isPending
            ? `Sign in to connect ${app.name}`
            : "Sign in"
        }
      />
      <p className="text-muted-foreground text-center text-sm">
        New here?{" "}
        <Link
          className="text-foreground underline underline-offset-4"
          to="/join"
        >
          Create an account
        </Link>
      </p>
    </main>
  );
};
