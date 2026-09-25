import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import * as z from "zod/mini";

import { SessionExpired } from "@/components/session-expired";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api, failure, isExpired } from "@/lib/api";

import type { FragmentExport, ImportResult } from "../contract/memory";

const FORMAT: FragmentExport["format"] = "memsys.fragments";

// Enough to preview a file; the worker validates every item and field.
const fileSchema = z.looseObject({
  format: z.literal(FORMAT),
  fragments: z.array(z.unknown()),
  version: z.literal(1),
});
type ImportFile = z.infer<typeof fileSchema>;

interface Picked {
  body: ImportFile;
  count: number;
  name: string;
}

const plural = (count: number) =>
  `${count} ${count === 1 ? "memory" : "memories"}`;

const summary = ({ conflicts, imported, skipped }: ImportResult) =>
  [
    imported > 0
      ? `Imported ${plural(imported)}.`
      : "No new memories to import.",
    skipped > 0
      ? `${plural(skipped)} ${skipped === 1 ? "was" : "were"} already here.`
      : "",
    conflicts.length > 0
      ? `Kept your current version of ${plural(conflicts.length)} that differ from the file: ${conflicts.join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

// Imports are all or nothing, so every failure left memory unchanged.
const problem = (error: Error) => {
  const { problem: body, status } = failure(error);
  if (status === 413) {
    return "Nothing was imported. The file is larger than 5 MB.";
  }
  return body.error
    ? `Nothing was imported. Fix these problems in the file and try again:\n${body.error}`
    : "Import failed. Your memories are unchanged.";
};

const read = async (file: File): Promise<Picked | null> => {
  try {
    const parsed = z.safeParse(fileSchema, JSON.parse(await file.text()));
    return parsed.success
      ? {
          body: parsed.data,
          count: parsed.data.fragments.length,
          name: file.name,
        }
      : null;
  } catch {
    return null;
  }
};

// Export downloads the whole memory; import merges a file into it.
export const DataView = () => {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (body: ImportFile) =>
      // A large memory can take longer than ky's default ten seconds.
      api
        .post("/api/import", { json: body, timeout: 60_000 })
        .json<ImportResult>(),
    onSuccess: () => {
      setPicked(null);
      void queryClient.invalidateQueries({ queryKey: ["fragments"] });
    },
  });

  const pick = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    mutation.reset();
    const result = await read(file);
    setPicked(result);
    setUnreadable(result ? null : file.name);
  };

  if (isExpired(mutation.error)) {
    return <SessionExpired />;
  }

  const feedback =
    unreadable || picked || mutation.isError || mutation.isSuccess;

  return (
    <section aria-label="Data">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Export</CardTitle>
            <CardDescription>
              Download all your memories as a JSON file.
            </CardDescription>
            <CardAction>
              <a
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" })
                )}
                download
                href="/api/export"
              >
                <Download aria-hidden="true" />
                Export
              </a>
            </CardAction>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Import</CardTitle>
            <CardDescription>
              Add memories from a memsys export file. Memories you already have
              stay as they are.
            </CardDescription>
            <CardAction>
              <Button
                disabled={mutation.isPending}
                onClick={() => input.current?.click()}
                size="sm"
                variant="outline"
              >
                <Upload aria-hidden="true" />
                Choose file
              </Button>
              <input
                accept="application/json,.json"
                aria-label="Import file"
                className="hidden"
                onChange={(event) => {
                  void pick(event.target.files?.[0]);
                  // Picking the same file again should still trigger a change.
                  event.target.value = "";
                }}
                ref={input}
                type="file"
              />
            </CardAction>
          </CardHeader>

          {feedback ? (
            <CardContent className="space-y-3">
              {unreadable ? (
                <Alert className="bg-amber-50 text-amber-950 ring-amber-300">
                  <AlertDescription className="text-amber-950">
                    {unreadable} is not a memsys export file.
                  </AlertDescription>
                </Alert>
              ) : null}

              {picked ? (
                <Alert className="flex flex-wrap items-center justify-between gap-3">
                  <AlertDescription className="text-foreground">
                    Import {plural(picked.count)} from {picked.name}?
                  </AlertDescription>
                  <div className="flex gap-2">
                    <Button
                      disabled={mutation.isPending}
                      onClick={() => {
                        setPicked(null);
                        mutation.reset();
                      }}
                      size="sm"
                      variant="outline"
                    >
                      Cancel
                    </Button>
                    <Button
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate(picked.body)}
                      size="sm"
                    >
                      {mutation.isPending ? "Importing…" : "Import"}
                    </Button>
                  </div>
                </Alert>
              ) : null}

              {mutation.isError ? (
                <Alert className="bg-amber-50 text-amber-950 ring-amber-300">
                  <AlertDescription className="max-h-48 overflow-y-auto whitespace-pre-wrap text-amber-950">
                    {problem(mutation.error)}
                  </AlertDescription>
                </Alert>
              ) : null}

              {mutation.isSuccess ? (
                <Alert>
                  <AlertDescription className="text-foreground">
                    {summary(mutation.data)}
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          ) : null}
        </Card>
      </div>
    </section>
  );
};
