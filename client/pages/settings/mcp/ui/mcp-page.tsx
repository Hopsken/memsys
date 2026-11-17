import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { Check, Copy, Plus } from "lucide-react";
import { useState } from "react";

import { ASSIGNMENTS } from "@/entities/persona";
import { SessionExpired } from "@/features/auth";
import { api, failure, http, isExpired } from "@/shared/api";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { RowMenu } from "@/shared/ui/row-menu";
import { Skeleton } from "@/shared/ui/skeleton";
import { formatRelativeDateInline } from "@lib/date";

import { AgentDialog, AgentName } from "./agent-dialog";
import { access, ConnectedApps } from "./connected-apps";

interface ApiKey {
  createdAt: string;
  id: string;
  lastRequest: string | null;
  name: string | null;
  permissions: Record<string, string[]> | null;
  start: string | null;
}

interface CreatedApiKey {
  key: string;
  name: string;
  scopes: string[];
}

const READ = "memory:read";
const WRITE = "memory:write";

const scopesOf = ({ permissions }: ApiKey) => {
  const createdBeforeAccessLevels = permissions === null;
  if (createdBeforeAccessLevels) {
    return [READ, WRITE];
  }
  return (permissions["memory"] ?? []).map((action) => `memory:${action}`);
};

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

const NewApiKeyDialog = ({
  created,
  onDone,
}: {
  created: CreatedApiKey | null;
  onDone: () => void;
}) => {
  const url = mcpUrl();
  const secret = created?.key ?? "";
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
    <Dialog
      disablePointerDismissal
      onOpenChange={(_open, { cancel }) => cancel()}
      open={created !== null}
    >
      <DialogContent
        className="grid-cols-[minmax(0,1fr)] sm:max-w-lg"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Copy your new API key</DialogTitle>
          <DialogDescription>
            {created?.name} · {access(created?.scopes ?? [])}
          </DialogDescription>
        </DialogHeader>
        <Alert className="bg-amber-50 text-amber-950 ring-amber-300">
          <AlertDescription className="text-amber-950">
            This is the only time you’ll see this key. Copy it now.
          </AlertDescription>
        </Alert>
        <div className="flex min-w-0 items-center gap-2">
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
        <DialogFooter>
          <Button onClick={onDone}>I’ve copied it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const CreateApiKeyForm = ({
  onCreated,
}: {
  onCreated: (created: CreatedApiKey) => void;
}) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [write, setWrite] = useState(true);
  const create = useMutation({
    mutationFn: (json: { name: string; write: boolean }) =>
      parseResponse(api["api-keys"].$post({ json })),
    mutationKey: [...API_KEYS, "create"],
    onSuccess: ({ key }, json) => {
      onCreated({
        key,
        name: json.name,
        scopes: json.write ? [READ, WRITE] : [READ],
      });
      void queryClient.invalidateQueries({ queryKey: API_KEYS });
    },
  });

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate({ name: name.trim(), write });
      }}
    >
      <DialogHeader>
        <DialogTitle>Create API key</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="api-key-name">Name</Label>
        <Input
          autoFocus
          id="api-key-name"
          maxLength={64}
          onChange={(event) => setName(event.target.value)}
          placeholder="Backup script"
          required
          value={name}
        />
      </div>
      <fieldset className="space-y-3 text-sm">
        <legend className="mb-2 font-medium">Access</legend>
        <label className="text-muted-foreground flex items-center gap-3">
          <Checkbox checked disabled />
          Read your memories
        </label>
        <label className="flex cursor-pointer items-center gap-3">
          <Checkbox checked={write} onCheckedChange={setWrite} />
          Add, change, and delete your memories
        </label>
      </fieldset>
      {create.error ? (
        <p className="text-destructive text-sm" role="alert">
          {describe(create.error)}
        </p>
      ) : null}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button disabled={create.isPending || name.trim() === ""} type="submit">
          {create.isPending ? "Creating…" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
};

const CreateApiKeyDialog = ({
  onCreated,
  onOpenChange,
  open,
}: {
  onCreated: (created: CreatedApiKey) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) => (
  <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent className="sm:max-w-md">
      <CreateApiKeyForm onCreated={onCreated} />
    </DialogContent>
  </Dialog>
);

const ApiKeyRow = ({ apiKey }: { apiKey: ApiKey }) => {
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: () =>
      http.post("/api/auth/api-key/delete", { json: { keyId: apiKey.id } }),
    mutationKey: [...API_KEYS, apiKey.id],
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: API_KEYS }),
        queryClient.invalidateQueries({ queryKey: ASSIGNMENTS }),
      ]),
  });
  const [picking, setPicking] = useState(false);
  const connection = `apiKey:${apiKey.id}` as const;
  const name = apiKey.name ?? "API key";
  return (
    <li className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-medium">{apiKey.name}</p>
        <p className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
          <span className="font-mono">{apiKey.start}…</span>
          <span>{access(scopesOf(apiKey))}</span>
          <span>Created {formatRelativeDateInline(apiKey.createdAt)}</span>
          <span>
            {apiKey.lastRequest
              ? `Last used ${formatRelativeDateInline(apiKey.lastRequest)}`
              : "Never used"}
          </span>
          <AgentName connection={connection} />
        </p>
      </div>
      <RowMenu
        action="Revoke"
        description="Tools using it lose access to your memories right away, and you can’t undo this."
        name={name}
        pending="Revoking…"
        remove={revoke}
        title={`Revoke ${apiKey.name ?? "this API key"}?`}
      >
        <DropdownMenuItem onClick={() => setPicking(true)}>
          Agent…
        </DropdownMenuItem>
      </RowMenu>
      <AgentDialog
        connection={connection}
        name={name}
        onOpenChange={setPicking}
        open={picking}
      />
    </li>
  );
};

export const ApiKeysView = () => {
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const query = useQuery({
    queryFn: async ({ signal }) => {
      const { apiKeys } = await http
        .get("/api/auth/api-key/list", {
          searchParams: { sortBy: "createdAt", sortDirection: "desc" },
          signal,
        })
        .json<{ apiKeys: ApiKey[] }>();
      return apiKeys;
    },
    queryKey: API_KEYS,
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
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="mb-1 font-medium">API keys</h2>
            <p className="text-muted-foreground text-sm">
              If a tool doesn’t ask you to sign in, give it an API key instead.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            Create API key
          </Button>
        </div>
        <CreateApiKeyDialog
          onCreated={(next) => {
            setCreating(false);
            setCreated(next);
          }}
          onOpenChange={setCreating}
          open={creating}
        />
        <NewApiKeyDialog created={created} onDone={() => setCreated(null)} />

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
