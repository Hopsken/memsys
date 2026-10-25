import type { UseMutationResult } from "@tanstack/react-query";
import { Ellipsis } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

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
} from "./alert-dialog";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

interface RowMenuProps {
  action: string;
  children?: ReactNode;
  description: string;
  name: string;
  pending: string;
  remove: UseMutationResult<unknown, Error, void>;
  title: string;
}

export const RowMenu = ({
  action,
  children,
  description,
  name,
  pending,
  remove,
  title,
}: RowMenuProps) => {
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
          {children ? (
            <>
              {children}
              <DropdownMenuSeparator />
            </>
          ) : null}
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
