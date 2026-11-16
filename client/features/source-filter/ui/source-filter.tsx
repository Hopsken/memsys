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
  from,
  onChange,
}: {
  className?: string;
  from: Source | null;
  onChange: (from: Source | null) => void;
}) => {
  const personas = usePersonas();
  const written = useQuery({
    queryFn: ({ signal }) =>
      parseResponse(api.sources.$get(undefined, { init: { signal } })),
    queryKey: ["sources"],
  });
  const wrote = new Set(written.data?.map((summary) => summary.from));
  const withChanges = personas.data?.filter(({ id }) =>
    wrote.has(`persona:${id}`)
  );
  const active = withChanges?.filter(({ archivedAt }) => archivedAt === null);
  const archived = withChanges?.filter(({ archivedAt }) => archivedAt !== null);
  const apps =
    written.data?.flatMap(({ from: source }) =>
      source.startsWith("agent:") ? [source] : []
    ) ?? [];
  const selected = from === null ? null : sourceLabel(from, personas.data);
  const selectedName = selected?.name === "you" ? "You" : selected?.name;

  return (
    <div className={cn("-ml-2.75 flex items-center gap-1", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              className="rounded-full"
              size="sm"
              variant={from === null ? "outline" : "secondary"}
            />
          }
        >
          {from === null ? "Everyone" : (selectedName ?? "…")}
          <ChevronDown aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuRadioGroup
            onValueChange={(value: string) =>
              onChange(isSource(value) ? value : null)
            }
            value={from ?? EVERYONE}
          >
            <DropdownMenuRadioItem closeOnClick value={EVERYONE}>
              Everyone
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem closeOnClick value="user">
              You
            </DropdownMenuRadioItem>
            <SourceGroup
              label="Agents"
              sources={(active ?? []).map(({ id, name }) => ({
                label: name,
                value: `persona:${id}`,
              }))}
            />
            <SourceGroup
              label="Apps"
              sources={apps.map((source) => ({
                label: sourceLabel(source, personas.data)?.name ?? source,
                value: source,
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
      {from === null ? null : (
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
