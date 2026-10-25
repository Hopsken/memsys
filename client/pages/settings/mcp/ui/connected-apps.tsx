import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { useState } from "react";

import { ASSIGNMENTS } from "@/entities/persona";
import { api } from "@/shared/api";
import type { Connection } from "@/shared/api";
import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";
import { RowMenu } from "@/shared/ui/row-menu";
import { formatRelativeDateInline } from "@lib/date";

import { AgentDialog, AgentName } from "./agent-dialog";

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
  const disconnect = useMutation({
    mutationFn: () =>
      api.connections[":id"].$delete({ param: { id: connection.id } }),
    mutationKey: [...CONNECTIONS, connection.id],
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: CONNECTIONS }),
        queryClient.invalidateQueries({ queryKey: ASSIGNMENTS }),
      ]),
  });
  const [picking, setPicking] = useState(false);
  const name = connection.name ?? "Unnamed app";
  return (
    <li className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
          <span>{access(connection.scopes)}</span>
          <span>
            Connected {formatRelativeDateInline(connection.createdAt)}
          </span>
          <AgentName connection={connection.connection} />
        </p>
      </div>
      <RowMenu
        action="Disconnect"
        description="It loses access to your memories until you connect it again."
        name={name}
        pending="Disconnecting…"
        remove={disconnect}
        title={`Disconnect ${connection.name ?? "this app"}?`}
      >
        <DropdownMenuItem onClick={() => setPicking(true)}>
          Agent…
        </DropdownMenuItem>
      </RowMenu>
      <AgentDialog
        connection={connection.connection}
        name={name}
        onOpenChange={setPicking}
        open={picking}
      />
    </li>
  );
};

export const ConnectedApps = () => {
  const query = useQuery({
    queryFn: ({ signal }) =>
      parseResponse(api.connections.$get(undefined, { init: { signal } })),
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
