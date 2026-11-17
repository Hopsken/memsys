import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { parseResponse } from "hono/client";
import { ChevronDown, XIcon } from "lucide-react";

import { isSource, sourceLabel, usePersonas } from "@/entities/persona";
import { api } from "@/shared/api";
import type { Source } from "@/shared/api";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

const EVERYONE = "";

const SourceGroup = ({
  label,
  sources,
}: {
  label: string;
  sources: { label: string; value: Source }[];
}) =>
  sources.length > 0 ? (
    <DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      {sources.map((source) => (
        <DropdownMenuRadioItem
          closeOnClick
          key={source.value}
          value={source.value}
        >
          {source.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuGroup>
  ) : null;

export const SourceFilter = ({
  className,
  onChange,
  source,
}: {
  className?: string;
  onChange: (source: Source | null) => void;
  source: Source | null;
}) => {
  const personas = usePersonas();
  const written = useQuery({
    queryFn: ({ signal }) =>
      parseResponse(api.sources.$get(undefined, { init: { signal } })),
    queryKey: ["sources"],
  });
  const wrote = new Set(written.data?.map((summary) => summary.source));
  const withChanges = personas.data?.filter(({ id }) =>
    wrote.has(`persona:${id}`)
  );
  const active = withChanges?.filter(({ archivedAt }) => archivedAt === null);
  const archived = withChanges?.filter(({ archivedAt }) => archivedAt !== null);
  const apps =
    written.data?.flatMap(({ source: each }) =>
      each.startsWith("agent:") ? [each] : []
    ) ?? [];
  const selected = source === null ? null : sourceLabel(source, personas.data);
  const selectedName = selected?.name === "you" ? "You" : selected?.name;

  return (
    <div className={cn("-ml-2.75 flex items-center gap-1", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              className="rounded-full"
              size="sm"
              variant={source === null ? "outline" : "secondary"}
            />
          }
        >
          {source === null ? "Everyone" : (selectedName ?? "…")}
          <ChevronDown aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuRadioGroup
            onValueChange={(value: string) =>
              onChange(isSource(value) ? value : null)
            }
            value={source ?? EVERYONE}
          >
            <DropdownMenuRadioItem closeOnClick value={EVERYONE}>
              Everyone
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem closeOnClick value="user">
              You
            </DropdownMenuRadioItem>
            {wrote.has("system") ? (
              <DropdownMenuRadioItem closeOnClick value="system">
                memsys
              </DropdownMenuRadioItem>
            ) : null}
            <SourceGroup
              label="Agents"
              sources={(active ?? []).map(({ id, name }) => ({
                label: name,
                value: `persona:${id}`,
              }))}
            />
            <SourceGroup
              label="Apps"
              sources={apps.map((agent) => ({
                label: sourceLabel(agent, personas.data)?.name ?? agent,
                value: agent,
              }))}
            />
            <SourceGroup
              label="Archived"
              sources={(archived ?? []).map(({ id, name }) => ({
                label: name,
                value: `persona:${id}`,
              }))}
            />
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {source === null ? null : (
        <Button
          aria-label="Clear filter"
          className="rounded-full"
          onClick={() => onChange(null)}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon aria-hidden="true" />
        </Button>
      )}
    </div>
  );
};
