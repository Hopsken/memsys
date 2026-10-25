import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { parseResponse } from "hono/client";
import { ChevronDown, XIcon } from "lucide-react";

import { authorLabel, isAuthor, usePersonas } from "@/entities/persona";
import { api } from "@/shared/api";
import type { Author } from "@/shared/api";
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

const AuthorGroup = ({
  authors,
  label,
}: {
  authors: { label: string; value: Author }[];
  label: string;
}) =>
  authors.length > 0 ? (
    <DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      {authors.map((author) => (
        <DropdownMenuRadioItem
          closeOnClick
          key={author.value}
          value={author.value}
        >
          {author.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuGroup>
  ) : null;

export const AuthorFilter = ({
  by,
  className,
  onChange,
}: {
  by: Author | null;
  className?: string;
  onChange: (by: Author | null) => void;
}) => {
  const personas = usePersonas();
  const authors = useQuery({
    queryFn: ({ signal }) =>
      parseResponse(api.authors.$get(undefined, { init: { signal } })),
    queryKey: ["authors"],
  });
  const wrote = new Set(authors.data?.map((author) => author.by));
  const withChanges = personas.data?.filter(({ id }) =>
    wrote.has(`persona:${id}`)
  );
  const active = withChanges?.filter(({ archivedAt }) => archivedAt === null);
  const archived = withChanges?.filter(({ archivedAt }) => archivedAt !== null);
  const apps =
    authors.data?.flatMap(({ by: author }) =>
      author.startsWith("agent:") ? [author] : []
    ) ?? [];
  const selected = by === null ? null : authorLabel(by, personas.data);
  const selectedName = selected?.name === "you" ? "You" : selected?.name;

  return (
    <div className={cn("-ml-2.75 flex items-center gap-1", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              className="rounded-full"
              size="sm"
              variant={by === null ? "outline" : "secondary"}
            />
          }
        >
          {by === null ? "Everyone" : (selectedName ?? "…")}
          <ChevronDown aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuRadioGroup
            onValueChange={(value: string) =>
              onChange(isAuthor(value) ? value : null)
            }
            value={by ?? EVERYONE}
          >
            <DropdownMenuRadioItem closeOnClick value={EVERYONE}>
              Everyone
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem closeOnClick value="user">
              You
            </DropdownMenuRadioItem>
            <AuthorGroup
              authors={(active ?? []).map(({ id, name }) => ({
                label: name,
                value: `persona:${id}`,
              }))}
              label="Agents"
            />
            <AuthorGroup
              authors={apps.map((author) => ({
                label: authorLabel(author, personas.data)?.name ?? author,
                value: author,
              }))}
              label="Apps"
            />
            <AuthorGroup
              authors={(archived ?? []).map(({ id, name }) => ({
                label: name,
                value: `persona:${id}`,
              }))}
              label="Archived"
            />
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {by === null ? null : (
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
