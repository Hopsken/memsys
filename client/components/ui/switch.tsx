import type * as React from "react";

import { cn } from "@/lib/utils";

const Switch = ({
  checked,
  className,
  onCheckedChange,
  ...props
}: Omit<React.ComponentProps<"button">, "onChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) => (
  <button
    aria-checked={checked}
    className={cn(
      "focus-visible:ring-ring/50 data-[state=checked]:bg-primary inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors outline-none focus-visible:ring-[3px] disabled:opacity-50 data-[state=unchecked]:bg-neutral-300",
      className
    )}
    data-slot="switch"
    data-state={checked ? "checked" : "unchecked"}
    onClick={() => onCheckedChange(!checked)}
    role="switch"
    type="button"
    {...props}
  >
    <span
      className={cn(
        "block size-4 rounded-full bg-white shadow-sm transition-transform",
        checked ? "translate-x-4" : "translate-x-0"
      )}
    />
  </button>
);

export { Switch };
