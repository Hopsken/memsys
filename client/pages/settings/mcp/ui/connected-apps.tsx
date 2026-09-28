import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/shared/api";
import { formatRelativeDateInline } from "@lib/date";

import { RemoveMenu } from "./remove-menu";

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
  const disconnect = useMutation({
    mutationFn: () => api.delete(`/api/connections/${connection.id}`),
    mutationKey: [...CONNECTIONS, connection.id],
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONNECTIONS }),
  });
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
        </p>
      </div>
      <RemoveMenu
        action="Disconnect"
        description="It loses access to your memories until you connect it again."
        name={name}
        pending="Disconnecting…"
        remove={disconnect}
        title={`Disconnect ${connection.name ?? "this app"}?`}
      />
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
