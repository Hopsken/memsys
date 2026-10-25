import { cn } from "cn";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import {
  useAssignments,
  useAssignPersona,
  useCreatePersona,
  usePersonas,
} from "@/entities/persona";
import { failure } from "@/shared/api";
import type { Persona } from "@/shared/api";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

export type ConnectionKey = `apiKey:${string}` | `oauth:${string}`;

const describe = (error: Error) => {
  const { problem } = failure(error);
  return problem.error ?? problem.message ?? "Something went wrong. Try again.";
};

export const useConnectionAgent = (
  connection: ConnectionKey
): Persona | null => {
  const personas = usePersonas();
  const assignments = useAssignments();
  const personaId = assignments.data?.find(
    (assignment) => assignment.connection === connection
  )?.personaId;
  return personas.data?.find(({ id }) => id === personaId) ?? null;
};

const Choice = ({
  checked,
  hint,
  label,
  onSelect,
}: {
  checked: boolean;
  hint?: string;
  label: string;
  onSelect: () => void;
}) => (
  <label
    className={cn(
      "hover:bg-muted flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2 text-sm",
      checked && "bg-muted"
    )}
  >
    <input
      checked={checked}
      className="accent-foreground mt-0.5 size-4"
      name="agent"
      onChange={onSelect}
      type="radio"
    />
    <span className="min-w-0">
      <span className="block truncate">{label}</span>
      {hint ? (
        <span className="text-muted-foreground block text-xs">{hint}</span>
      ) : null}
    </span>
  </label>
);

export const AgentDialog = ({
  connection,
  name,
  onOpenChange,
  open,
}: {
  connection: ConnectionKey;
  name: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) => {
  const personas = usePersonas();
  const current = useConnectionAgent(connection)?.id ?? null;
  const assign = useAssignPersona();
  const create = useCreatePersona();
  const [choice, setChoice] = useState<string | null>(current);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const active =
    personas.data?.filter(({ archivedAt }) => archivedAt === null) ?? [];
  const error = assign.error ?? create.error;

  useEffect(() => {
    if (open) {
      setChoice(current);
      setAdding(false);
      setNewName("");
      assign.reset();
      create.reset();
    }
    // Reset only when the dialog opens.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const addAgent = () => {
    const trimmed = newName.trim();
    if (trimmed === "") {
      return;
    }
    create.mutate(trimmed, {
      onSuccess: (persona) => {
        setChoice(persona.id);
        setAdding(false);
        setNewName("");
      },
    });
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            assign.mutate(
              { connection, personaId: choice },
              { onSuccess: () => onOpenChange(false) }
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Agent for {name}</DialogTitle>
            <DialogDescription>
              New changes from {name} will show under this agent. Earlier
              changes keep the name they have now.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="-mx-1 max-h-72 space-y-0.5 overflow-y-auto px-1">
            <legend className="sr-only">Agent</legend>
            <Choice
              checked={choice === null}
              hint={`Show as ${name}`}
              label="No agent"
              onSelect={() => setChoice(null)}
            />
            {active.map((persona) => (
              <Choice
                checked={choice === persona.id}
                key={persona.id}
                label={persona.name}
                onSelect={() => setChoice(persona.id)}
              />
            ))}
          </fieldset>
          {adding ? (
            <div className="flex gap-2">
              <Input
                aria-label="New agent name"
                autoFocus
                maxLength={64}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addAgent();
                  }
                }}
                placeholder="Work assistant"
                value={newName}
              />
              <Button
                disabled={create.isPending || newName.trim() === ""}
                onClick={addAgent}
                type="button"
                variant="outline"
              >
                {create.isPending ? "Adding…" : "Add"}
              </Button>
            </div>
          ) : (
            <Button
              className="text-muted-foreground"
              onClick={() => setAdding(true)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Plus aria-hidden="true" />
              New agent
            </Button>
          )}
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {describe(error)}
            </p>
          ) : null}
          <DialogFooter className="items-center sm:justify-between">
            <Link
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
              to="/settings/agents"
            >
              Manage agents
            </Link>
            <div className="flex gap-2">
              <Button
                onClick={() => onOpenChange(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                disabled={assign.isPending || choice === current}
                type="submit"
              >
                {assign.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export const AgentName = ({ connection }: { connection: ConnectionKey }) => {
  const agent = useConnectionAgent(connection);
  return agent ? (
    <span className="text-foreground/80">{agent.name}</span>
  ) : (
    <span>No agent</span>
  );
};
