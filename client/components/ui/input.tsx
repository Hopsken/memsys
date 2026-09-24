import type * as React from "react";

import { cn } from "@/lib/utils";

const Input = ({ className, ...props }: React.ComponentProps<"input">) => (
  <input
    data-slot="input"
    className={cn(
      "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 h-9 w-full min-w-0 rounded-md border bg-white px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:opacity-50",
      className
    )}
    {...props}
  />
);

export { Input };
