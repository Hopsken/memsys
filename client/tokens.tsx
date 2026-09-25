import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Check, Copy, KeyRound, Plus } from "lucide-react";
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

import { formatRelativeDate } from "../lib/date";

// MCP tokens are Better Auth API keys; the list never includes the secret.
interface Token {
  createdAt: string;
  id: string;
  lastRequest: string | null;
  name: string | null;
  start: string | null;
}

const TOKENS = ["tokens"];

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
const NewToken = ({
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
        <CardTitle>Copy your new token</CardTitle>
        <CardDescription>
          It will not be shown again. Anyone with it can read and change your
          memory.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Input
            aria-label="New token"
            className="font-mono"
            onFocus={(event) => event.target.select()}
            readOnly
            value={secret}
          />
          <CopyButton label="Copy token" value={secret} />
        </div>
        <Snippet label="Claude Code" value={claude} />
        <Snippet label="MCP client config" value={config} />
        <div className="flex justify-end">
          <Button onClick={onDone} size="sm">
            Done
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

const TokenRow = ({ token }: { token: Token }) => {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const revoke = useMutation({
    mutationFn: () =>
      api.post("/api/auth/api-key/delete", { json: { keyId: token.id } }),
    mutationKey: [...TOKENS, token.id],
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TOKENS }),
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3.5">
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-medium">{token.name}</p>
        <p className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
          <span className="font-mono">{token.start}…</span>
          <span>Created {formatRelativeDate(token.createdAt)}</span>
          <span>
            {token.lastRequest
              ? `Last used ${formatRelativeDate(token.lastRequest)}`
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

export const TokensView = () => {
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
        .json<{ apiKeys: Token[] }>();
      return apiKeys;
    },
    queryKey: TOKENS,
  });
  const create = useMutation({
    mutationFn: (tokenName: string) =>
      api
        .post("/api/auth/api-key/create", { json: { name: tokenName } })
        .json<{ key: string }>(),
    mutationKey: [...TOKENS, "create"],
    onSuccess: ({ key }) => {
      setSecret(key);
      setName("");
      void queryClient.invalidateQueries({ queryKey: TOKENS });
    },
  });
  const mutationErrors = useMutationState({
    filters: { mutationKey: TOKENS, status: "error" },
    select: (mutation) => mutation.state.error,
  });

  if ([query.error, ...mutationErrors].some(isExpired)) {
    return <SessionExpired />;
  }

  return (
    <section aria-busy={query.isFetching} aria-label="MCP tokens">
      <p className="text-muted-foreground mb-6 text-sm">
        Agents connect to <code className="font-mono">{mcpUrl()}</code> with a
        token as a bearer header.
      </p>

      {secret ? (
        <NewToken onDone={() => setSecret(null)} secret={secret} />
      ) : (
        <form
          className="mb-6 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(name.trim());
          }}
        >
          <div className="min-w-48 flex-1 space-y-2">
            <Label htmlFor="token-name">Name</Label>
            <Input
              id="token-name"
              maxLength={64}
              onChange={(event) => setName(event.target.value)}
              placeholder="Claude Code on laptop"
              required
              value={name}
            />
          </div>
          <Button
            disabled={create.isPending || name.trim() === ""}
            type="submit"
          >
            <Plus aria-hidden="true" />
            {create.isPending ? "Creating…" : "Create token"}
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
            Could not load tokens.
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
          <span className="sr-only">Loading tokens</span>
          {[1, 2].map((key) => (
            <div className="space-y-2 py-3.5" key={key}>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
          ))}
        </div>
      ) : null}
      {query.data?.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-12 text-center">
          <KeyRound
            aria-hidden="true"
            className="text-muted-foreground mx-auto mb-4 size-6"
          />
          <h2 className="font-medium">No tokens yet</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Create one for each agent or device you connect.
          </p>
        </div>
      ) : null}
      <ul className="divide-y">
        {query.data?.map((token) => (
          <TokenRow key={token.id} token={token} />
        ))}
      </ul>
    </section>
  );
};
