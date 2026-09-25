import { useMutation } from "@tanstack/react-query";
import { Check, Layers } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { useConnectingApp } from "@/lib/oauth";

const READ = "memory:read";
const WRITE = "memory:write";

const Granted = ({ text }: { text: string }) => (
  <li className="flex items-center gap-3">
    <Check aria-hidden="true" className="size-4" />
    {text}
  </li>
);

// Better Auth sends the user here, signed in, when an app asks for access.
// Reading comes with any connection; changing memories is the user's call.
export const ConsentView = () => {
  const [params] = useSearchParams();
  const session = authClient.useSession();
  const app = useConnectingApp();
  const requested = (params.get("scope") ?? "").split(" ");
  const asksRead = requested.includes(READ);
  const asksWrite = requested.includes(WRITE);
  const [write, setWrite] = useState(true);
  const answer = useMutation({
    mutationFn: async (accept: boolean) => {
      // offline_access keeps the app signed in; it is not a choice.
      const granted = [READ, "offline_access", ...(write ? [WRITE] : [])];
      // Where the browser goes next: back to the app with a code, or with an
      // error if the user said no.
      const { url } = await api
        .post("/api/auth/oauth2/consent", {
          json: {
            accept,
            oauth_query: window.location.search.slice(1),
            ...(accept && {
              scope: granted
                .filter((scope) => requested.includes(scope))
                .join(" "),
            }),
          },
        })
        .json<{ url: string }>();
      window.location.assign(url);
    },
  });

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 px-5 py-10">
      <h1 className="flex items-center justify-center gap-3 text-3xl font-semibold tracking-tight">
        <Layers aria-hidden="true" className="size-7" />
        memsys
      </h1>
      <Card aria-busy={app.isPending}>
        <CardHeader>
          <CardTitle>
            {app.isPending ? (
              <Skeleton className="h-5 w-48" />
            ) : (
              `Connect ${app.name} to your memories?`
            )}
          </CardTitle>
          {session.data ? (
            <CardDescription>
              Signed in as {session.data.user.email}
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-5">
          <ul className="space-y-3 text-sm">
            {asksRead ? <Granted text="Read your memories" /> : null}
            {asksRead && asksWrite ? (
              <li>
                <label className="flex cursor-pointer items-center justify-between gap-4">
                  Also add, change, and delete them
                  <Switch checked={write} onCheckedChange={setWrite} />
                </label>
              </li>
            ) : null}
            {asksWrite && !asksRead ? (
              <Granted text="Add, change, and delete your memories" />
            ) : null}
          </ul>
          {app.isError || answer.isError ? (
            <Alert className="bg-amber-50 text-amber-950 ring-amber-300">
              <AlertDescription className="text-amber-950">
                Something went wrong. Go back to the app and connect again.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              disabled={answer.isPending}
              onClick={() => answer.mutate(false)}
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={answer.isPending || app.isPending}
              onClick={() => answer.mutate(true)}
            >
              {answer.isPending ? "Connecting…" : "Allow"}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            You can disconnect it anytime in Settings → MCP.
          </p>
        </CardContent>
      </Card>
    </main>
  );
};
