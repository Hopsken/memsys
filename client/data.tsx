import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";

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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, failure, isExpired } from "@/lib/api";

import type { ImportResult } from "../contract/memory";

interface Picked {
  file: File;
  type: string;
}

// The file type picks the format; the worker validates every line.
const mediaType = ({ name, type }: File) => {
  const lower = name.toLowerCase();
  if (lower.endsWith(".ndjson") || type === "application/x-ndjson") {
    return "application/x-ndjson";
  }
  if (lower.endsWith(".txt") || type === "text/plain") {
    return "text/plain";
  }
  return null;
};

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
    return "Nothing was imported. The file is larger than 10 MB.";
  }
  return body.error
    ? `Nothing was imported. Fix these problems in the file and try again:\n${body.error}`
    : "Import failed. Your memories are unchanged.";
};

// Export downloads the whole memory; import merges a file into it.
export const DataView = () => {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: ({ file, type }: Picked) =>
      // A large memory can take longer than ky's default ten seconds.
      api
        .post("/api/import", {
          body: file,
          headers: { "Content-Type": type },
          timeout: 60_000,
        })
        .json<ImportResult>(),
    onSuccess: () => {
      setPicked(null);
      void queryClient.invalidateQueries({ queryKey: ["fragments"] });
    },
  });

  const pick = (file: File | undefined) => {
    if (!file) {
      return;
    }
    mutation.reset();
    const type = mediaType(file);
    setPicked(type ? { file, type } : null);
    setUnreadable(type ? null : file.name);
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
            <CardDescription>Download your memories as a file.</CardDescription>
            <CardAction>
              <a
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" })
                )}
                download
                href={history ? "/api/export?history=true" : "/api/export"}
              >
                <Download aria-hidden="true" />
                Export
              </a>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Label className="text-muted-foreground font-normal">
              <Switch
                checked={history}
                onCheckedChange={setHistory}
                size="sm"
              />
              Include earlier versions and forgotten memories
            </Label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Import</CardTitle>
            <CardDescription>
              Add memories from a memsys export, or a text file with one memory
              per line. Memories you already have stay as they are.
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
                accept=".ndjson,.txt,application/x-ndjson,text/plain"
                aria-label="Import file"
                className="hidden"
                onChange={(event) => {
                  pick(event.target.files?.[0]);
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
                    {unreadable} is not a memsys export or a text file.
                  </AlertDescription>
                </Alert>
              ) : null}

              {picked ? (
                <Alert className="flex flex-wrap items-center justify-between gap-3">
                  <AlertDescription className="text-foreground">
                    Import memories from {picked.file.name}?
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
                      onClick={() => mutation.mutate(picked)}
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
