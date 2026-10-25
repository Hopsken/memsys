import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { useAssignPersona, usePersonas } from "@/entities/persona";
import { useConnectingApp } from "@/features/auth";
import { authClient, http } from "@/shared/api";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { Label } from "@/shared/ui/label";
import { Logo } from "@/shared/ui/logo";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";

const READ = "memory:read";
const WRITE = "memory:write";
const NO_AGENT = "";

const AgentField = ({
  app,
  onChange,
  value,
}: {
  app: string;
  onChange: (value: string) => void;
  value: string;
}) => {
  const personas = usePersonas();
  const agents =
    personas.data?.filter(({ archivedAt }) => archivedAt === null) ?? [];
  if (agents.length === 0) {
    return null;
  }
  return (
    <div className="space-y-2 border-t pt-5">
      <Label htmlFor="consent-agent">Which agent is this?</Label>
      <p className="text-muted-foreground text-xs">
        Optional. Its changes will show under this name.
      </p>
      <Select
        items={[
          { label: "No agent", value: NO_AGENT },
          ...agents.map(({ id, name }) => ({ label: name, value: id })),
        ]}
        onValueChange={(next) => onChange(next ?? NO_AGENT)}
        value={value}
      >
        <SelectTrigger className="w-full" id="consent-agent">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_AGENT}>
            <span className="flex flex-col">
              No agent
              <span className="text-muted-foreground text-xs">
                Show as {app}
              </span>
            </span>
          </SelectItem>
          {agents.map(({ id, name }) => (
            <SelectItem key={id} value={id}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export const ConsentView = () => {
  const [params] = useSearchParams();
  const session = authClient.useSession();
  const app = useConnectingApp();
  const requested = (params.get("scope") ?? "").split(" ");
  const asksWrite = requested.includes(WRITE);
  const [write, setWrite] = useState(true);
  const [agent, setAgent] = useState(NO_AGENT);
  const assign = useAssignPersona();
  const [unsavedAgentUrl, setUnsavedAgentUrl] = useState<string | null>(null);
  const clientId = params.get("client_id");
  const answer = useMutation({
    mutationFn: async (accept: boolean) => {
      const granted = [READ, "offline_access", ...(write ? [WRITE] : [])];
      const { url } = await http
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
      // The app gets its code only from this redirect, so saving the agent
      // first means it can never write before its agent is set.
      if (accept && agent !== NO_AGENT && clientId !== null) {
        try {
          await assign.mutateAsync({
            connection: `oauth:${clientId}`,
            personaId: agent,
          });
        } catch {
          setUnsavedAgentUrl(url);
          return;
        }
      }
      window.location.assign(url);
    },
  });

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 px-5 py-10">
      <h1 className="flex items-center justify-center gap-3 text-3xl font-semibold tracking-tight">
        <Logo className="size-10" />
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
            <li>
              <label className="text-muted-foreground flex items-center gap-3">
                <Checkbox checked disabled />
                Read your memories
              </label>
            </li>
            {asksWrite ? (
              <li>
                <label className="flex cursor-pointer items-center gap-3">
                  <Checkbox checked={write} onCheckedChange={setWrite} />
                  Add, change, and delete your memories
                </label>
              </li>
            ) : null}
          </ul>
          <AgentField app={app.name} onChange={setAgent} value={agent} />
          {unsavedAgentUrl ? (
            <Alert className="bg-amber-50 text-amber-950 ring-amber-300">
              <AlertDescription className="space-y-3 text-amber-950">
                <p>
                  {app.name} is connected, but its agent wasn’t saved. You can
                  pick it later in Settings → MCP.
                </p>
                <Button
                  onClick={() => window.location.assign(unsavedAgentUrl)}
                  size="sm"
                >
                  Continue
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {app.isError || answer.isError ? (
            <Alert className="bg-amber-50 text-amber-950 ring-amber-300">
              <AlertDescription className="text-amber-950">
                Something went wrong. Go back to the app and connect again.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              disabled={answer.isPending || unsavedAgentUrl !== null}
              onClick={() => answer.mutate(false)}
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={
                answer.isPending || app.isPending || unsavedAgentUrl !== null
              }
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
