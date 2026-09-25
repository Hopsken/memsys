import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Check, Copy, Plus } from "lucide-react";
import { useState } from "react";

import { SessionExpired } from "@/components/session-expired";
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
import { Skeleton } from "@/components/ui/skeleton";
import { api, failure, isExpired } from "@/lib/api";

import { formatRelativeDateInline } from "../lib/date";
import { ConnectedApps } from "./connections";

// Better Auth API keys; the list never includes the secret.
interface ApiKey {
  createdAt: string;
  id: string;
  lastRequest: string | null;
  name: string | null;
  start: string | null;
}

const API_KEYS = ["api-keys"];

const mcpUrl = () => `${window.location.origin}/mcp`;

const describe = (error: Error) => {
  const { problem } = failure(error);
  return problem.error ?? problem.message ?? "Something went wrong. Try again.";
};

const CopyButton = ({ label, value }: { label: string; value: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      aria-label={copied ? "Copied" : label}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      size="icon-sm"
      title={label}
      variant="outline"
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </Button>
  );
};

const Snippet = ({ label, value }: { label: string; value: string }) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <CopyButton label={`Copy ${label}`} value={value} />
    </div>
    <pre className="bg-muted overflow-x-auto rounded-lg px-3 py-2 font-mono text-xs leading-5">
      {value}
    </pre>
  </div>
);

// The secret exists only in this response; closing it loses it for good.
const NewApiKey = ({
  onDone,
  secret,
}: {
  onDone: () => void;
  secret: string;
}) => {
  const url = mcpUrl();
  const claude = `claude mcp add --transport http memsys ${url} --header "Authorization: Bearer ${secret}"`;
  const config = JSON.stringify(
    {
      mcpServers: {
        memsys: {
          headers: { Authorization: `Bearer ${secret}` },
          type: "http",
          url,
        },
      },
    },
    null,
    2
  );
  return (
    <Card className="ring-primary/30 mb-6">
      <CardHeader>
        <CardTitle>Copy your new API key</CardTitle>
        <CardDescription>
          You won’t see it again. Anyone who has it can read and change your
          memories.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Input
            aria-label="New API key"
            className="font-mono"
            onFocus={(event) => event.target.select()}
            readOnly
            value={secret}
          />
          <CopyButton label="Copy API key" value={secret} />
        </div>
        <Snippet label="Claude Code command" value={claude} />
        <Snippet label="MCP config for other apps" value={config} />
        <div className="flex justify-end">
          <Button onClick={onDone} size="sm">
            Done
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

const ApiKeyRow = ({ apiKey }: { apiKey: ApiKey }) => {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const revoke = useMutation({
    mutationFn: () =>
      api.post("/api/auth/api-key/delete", { json: { keyId: apiKey.id } }),
    mutationKey: [...API_KEYS, apiKey.id],
    onSuccess: () => queryClient.invalidateQueries({ queryKey: API_KEYS }),
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3.5">
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-medium">{apiKey.name}</p>
        <p className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
          <span className="font-mono">{apiKey.start}…</span>
          <span>Created {formatRelativeDateInline(apiKey.createdAt)}</span>
          <span>
            {apiKey.lastRequest
              ? `Last used ${formatRelativeDateInline(apiKey.lastRequest)}`
              : "Never used"}
          </span>
        </p>
        {revoke.error ? (
          <p className="text-destructive text-xs">{describe(revoke.error)}</p>
        ) : null}
      </div>
      {confirming ? (
        <div className="flex items-center gap-2">
          <Button
            disabled={revoke.isPending}
            onClick={() => setConfirming(false)}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={revoke.isPending}
            onClick={() => revoke.mutate()}
            size="sm"
            variant="destructive"
          >
            {revoke.isPending ? "Revoking…" : "Revoke"}
          </Button>
        </div>
      ) : (
        <Button onClick={() => setConfirming(true)} size="sm" variant="outline">
          Revoke
        </Button>
      )}
    </li>
  );
};

export const ApiKeysView = () => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const query = useQuery({
    queryFn: async ({ signal }) => {
      const { apiKeys } = await api
        .get("/api/auth/api-key/list", {
          searchParams: { sortBy: "createdAt", sortDirection: "desc" },
          signal,
        })
        .json<{ apiKeys: ApiKey[] }>();
      return apiKeys;
    },
    queryKey: API_KEYS,
  });
  const create = useMutation({
    mutationFn: (keyName: string) =>
      api
        .post("/api/auth/api-key/create", { json: { name: keyName } })
        .json<{ key: string }>(),
    mutationKey: [...API_KEYS, "create"],
    onSuccess: ({ key }) => {
      setSecret(key);
      setName("");
      void queryClient.invalidateQueries({ queryKey: API_KEYS });
    },
  });
  const mutationErrors = useMutationState({
    filters: { mutationKey: API_KEYS, status: "error" },
    select: (mutation) => mutation.state.error,
  });

  if ([query.error, ...mutationErrors].some(isExpired)) {
    return <SessionExpired />;
  }

  return (
    <>
      <div className="mb-8 space-y-3">
        <p className="text-muted-foreground text-sm">
          Add this URL to an AI tool, then sign in when it asks.
        </p>
        <Snippet label="MCP URL" value={mcpUrl()} />
        <Snippet
          label="Claude Code"
          value={`claude mcp add --transport http memsys ${mcpUrl()}`}
        />
      </div>

      <ConnectedApps />

      <section aria-busy={query.isFetching} aria-label="API keys">
        <h2 className="mb-1 font-medium">API keys</h2>
        <p className="text-muted-foreground mb-6 text-sm">
          If a tool doesn’t ask you to sign in, give it an API key instead.
        </p>

        {secret ? (
          <NewApiKey onDone={() => setSecret(null)} secret={secret} />
        ) : (
          <form
            className="mb-6 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate(name.trim());
            }}
          >
            <div className="min-w-48 flex-1 space-y-2">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                maxLength={64}
                onChange={(event) => setName(event.target.value)}
                placeholder="Backup script"
                required
                value={name}
              />
            </div>
            <Button
              disabled={create.isPending || name.trim() === ""}
              type="submit"
            >
              <Plus aria-hidden="true" />
              {create.isPending ? "Creating…" : "Create API key"}
            </Button>
            {create.error ? (
              <p className="text-destructive w-full text-xs">
                {describe(create.error)}
              </p>
            ) : null}
          </form>
        )}

        {query.isError ? (
          <Alert className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <AlertDescription className="text-foreground">
              Couldn’t load your API keys.
            </AlertDescription>
            <Button
              onClick={() => {
                void query.refetch();
              }}
              size="sm"
              variant="outline"
            >
              Try again
            </Button>
          </Alert>
        ) : null}
        {query.isPending ? (
          <div className="divide-y" role="status">
            <span className="sr-only">Loading API keys</span>
            {[1, 2].map((key) => (
              <div className="space-y-2 py-3.5" key={key}>
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64" />
              </div>
            ))}
          </div>
        ) : null}
        <ul className="divide-y">
          {query.data?.map((apiKey) => (
            <ApiKeyRow key={apiKey.id} apiKey={apiKey} />
          ))}
        </ul>
      </section>
    </>
  );
};
