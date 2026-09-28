import type { UseMutationResult } from "@tanstack/react-query";
import { Ellipsis } from "lucide-react";
import { useRef, useState } from "react";

import { failure } from "@/shared/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

interface RemoveMenuProps {
  action: string;
  description: string;
  name: string;
  pending: string;
  remove: UseMutationResult<unknown, Error, void>;
  title: string;
}

// Removing a row sits in its menu behind a confirmation, so it is never one
// stray click away.
export const RemoveMenu = ({
  action,
  description,
  name,
  pending,
  remove,
  title,
}: RemoveMenuProps) => {
  const trigger = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`More actions for ${name}`}
              ref={trigger}
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <Ellipsis aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => setConfirming(true)}
            variant="destructive"
          >
            {action}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        onOpenChange={(open) => {
          setConfirming(open);
          if (!open) {
            remove.reset();
          }
        }}
        open={confirming}
      >
        <AlertDialogContent finalFocus={trigger}>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {remove.error ? (
            <p className="text-destructive text-sm" role="alert">
              {failure(remove.error).problem.error ??
                failure(remove.error).problem.message ??
                "Something went wrong. Try again."}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              variant="destructive"
            >
              {remove.isPending ? pending : action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
