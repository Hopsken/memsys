import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { PERSONAS, useCreatePersona, usePersonas } from "@/entities/persona";
import { SessionExpired } from "@/features/auth";
import { api, failure, isExpired } from "@/shared/api";
import type { Persona } from "@/shared/api";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/ui/collapsible";
import {
  Dialog,
  DialogContent,
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

const describe = (error: Error) => {
  const { problem } = failure(error);
  return problem.error ?? problem.message ?? "Something went wrong. Try again.";
};

const connections = (count: number) => {
  if (count === 0) {
    return "No connections";
  }
  return count === 1 ? "1 connection" : `${count} connections`;
};

const archiveDescription = ({ connections: count }: Persona) => {
  const kept = "Its past changes keep its name.";
  if (count === 0) {
    return `It won’t be offered for new connections. ${kept}`;
  }
  const moved =
    count === 1
      ? "Its connection will show under its own name"
      : `Its ${count} connections will show under their own names`;
  return `${moved} from now on. ${kept}`;
};

const RenameDialog = ({
  onOpenChange,
  open,
  persona,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  persona: Persona;
}) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState(persona.name);
  const rename = useMutation({
    mutationFn: (next: string) =>
      parseResponse(
        api.personas[":id"].$patch({
          json: { name: next },
          param: { id: persona.id },
        })
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PERSONAS }),
  });
  return (
    <Dialog
      onOpenChange={(next) => {
        if (next) {
          setName(persona.name);
          rename.reset();
        }
        onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent className="sm:max-w-sm">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            rename.mutate(name.trim(), {
              onSuccess: () => onOpenChange(false),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename {persona.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`rename-${persona.id}`}>Name</Label>
            <Input
              autoFocus
              id={`rename-${persona.id}`}
              maxLength={64}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => event.target.select()}
              required
              value={name}
            />
            <p className="text-muted-foreground text-xs">
              Its past changes show the new name too.
            </p>
          </div>
          {rename.error ? (
            <p className="text-destructive text-sm" role="alert">
              {describe(rename.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={
                rename.isPending ||
                name.trim() === "" ||
                name.trim() === persona.name
              }
              type="submit"
            >
              {rename.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const PersonaRow = ({ persona }: { persona: Persona }) => {
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const archived = persona.archivedAt !== null;
  const archive = useMutation({
    mutationFn: () =>
      parseResponse(
        api.personas[":id"].archived.$put({
          json: { archived: !archived },
          param: { id: persona.id },
        })
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PERSONAS }),
  });
  const meta = [
    ...(archived ? [] : [connections(persona.connections)]),
    persona.lastChangeAt
      ? `Last change ${formatRelativeDateInline(persona.lastChangeAt)}`
      : "No changes yet",
  ];
  return (
    <li className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-medium">{persona.name}</p>
        <p className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
          {meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {persona.lastChangeAt ? (
          <Button
            render={
              <Link
                to={`/activity?${new URLSearchParams({ by: `persona:${persona.id}` })}`}
              />
            }
            size="sm"
            variant="ghost"
          >
            Activity
          </Button>
        ) : null}
        {archived ? (
          <Button
            disabled={archive.isPending}
            onClick={() => archive.mutate()}
            size="sm"
            variant="outline"
          >
            {archive.isPending ? "Restoring…" : "Unarchive"}
          </Button>
        ) : (
          <RowMenu
            action="Archive"
            description={archiveDescription(persona)}
            name={persona.name}
            pending="Archiving…"
            remove={archive}
            title={`Archive ${persona.name}?`}
          >
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              Rename
            </DropdownMenuItem>
          </RowMenu>
        )}
      </div>
      <RenameDialog
        onOpenChange={setRenaming}
        open={renaming}
        persona={persona}
      />
    </li>
  );
};

export const AgentsView = () => {
  const query = usePersonas();
  const create = useCreatePersona();
  const [name, setName] = useState("");
  const active =
    query.data?.filter(({ archivedAt }) => archivedAt === null) ?? [];
  const archived =
    query.data?.filter(({ archivedAt }) => archivedAt !== null) ?? [];

  if (isExpired(query.error) || isExpired(create.error)) {
    return <SessionExpired />;
  }

  return (
    <section aria-busy={query.isFetching} aria-label="Agents">
      <p className="text-muted-foreground mb-6 text-sm">
        Name the agents you use, then pick one for each app or key in{" "}
        <Link
          className="text-foreground underline underline-offset-4"
          to="/settings/mcp"
        >
          MCP
        </Link>
        . An agent’s changes stay together when you reconnect or change keys.
      </p>

      <form
        className="mb-6 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(name.trim(), { onSuccess: () => setName("") });
        }}
      >
        <div className="min-w-48 flex-1 space-y-2">
          <Label htmlFor="agent-name">Name</Label>
          <Input
            id="agent-name"
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
            placeholder="Travel planner"
            required
            value={name}
          />
        </div>
        <Button disabled={create.isPending || name.trim() === ""} type="submit">
          <Plus aria-hidden="true" />
          {create.isPending ? "Adding…" : "Add agent"}
        </Button>
        {create.error ? (
          <p className="text-destructive w-full text-xs">
            {describe(create.error)}
          </p>
        ) : null}
      </form>

      {query.isError ? (
        <Alert className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <AlertDescription className="text-foreground">
            Couldn’t load your agents.
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
          <span className="sr-only">Loading agents</span>
          {[1, 2].map((key) => (
            <div className="space-y-2 py-3.5" key={key}>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
          ))}
        </div>
      ) : null}
      <ul className="divide-y">
        {active.map((persona) => (
          <PersonaRow key={persona.id} persona={persona} />
        ))}
      </ul>

      {archived.length > 0 ? (
        <Collapsible className="mt-6">
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 group flex items-center gap-1 rounded-sm text-sm outline-none focus-visible:ring-3">
            <ChevronRight
              aria-hidden="true"
              className="size-4 transition-transform group-data-[panel-open]:rotate-90"
            />
            Archived · {archived.length}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="divide-y">
              {archived.map((persona) => (
                <PersonaRow key={persona.id} persona={persona} />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </section>
  );
};
