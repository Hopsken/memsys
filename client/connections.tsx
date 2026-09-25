import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { api, failure } from "@/lib/api";

import { formatRelativeDateInline } from "../lib/date";

// Apps the user let in through sign-in; API keys are listed separately.
interface Connection {
  createdAt: string;
  id: string;
  name: string | null;
  scopes: string[];
}

export const CONNECTIONS = ["connections"];

const access = (scopes: string[]) => {
  const read = scopes.includes("memory:read");
  const write = scopes.includes("memory:write");
  if (read && write) {
    return "Can read and change your memories";
  }
  return write ? "Can change your memories" : "Can read your memories";
};

const ConnectionRow = ({ connection }: { connection: Connection }) => {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const disconnect = useMutation({
    mutationFn: () => api.delete(`/api/connections/${connection.id}`),
    mutationKey: [...CONNECTIONS, connection.id],
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONNECTIONS }),
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3.5">
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-medium">
          {connection.name ?? "Unnamed app"}
        </p>
        <p className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
          <span>{access(connection.scopes)}</span>
          <span>
            Connected {formatRelativeDateInline(connection.createdAt)}
          </span>
        </p>
        {disconnect.error ? (
          <p className="text-destructive text-xs">
            {failure(disconnect.error).problem.error ??
              "Something went wrong. Try again."}
          </p>
        ) : null}
      </div>
      {confirming ? (
        <div className="flex items-center gap-2">
          <Button
            disabled={disconnect.isPending}
            onClick={() => setConfirming(false)}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate()}
            size="sm"
            variant="destructive"
          >
            {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
          </Button>
        </div>
      ) : (
        <Button onClick={() => setConfirming(true)} size="sm" variant="outline">
          Disconnect
        </Button>
      )}
    </li>
  );
};

// Shown only once an app is connected.
export const ConnectedApps = () => {
  const query = useQuery({
    queryFn: ({ signal }) =>
      api.get("/api/connections", { signal }).json<Connection[]>(),
    queryKey: CONNECTIONS,
  });
  if (!query.data?.length) {
    return null;
  }
  return (
    <section aria-label="Connected apps" className="mb-8">
      <h2 className="mb-1 font-medium">Connected apps</h2>
      <ul className="divide-y">
        {query.data.map((connection) => (
          <ConnectionRow connection={connection} key={connection.id} />
        ))}
      </ul>
    </section>
  );
};
