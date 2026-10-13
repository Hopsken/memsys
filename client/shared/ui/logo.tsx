import { cn } from "cn";

// The elephant mark from public/brand/. It always sits beside the name, so
// screen readers skip it.
export const Logo = ({ className }: { className?: string }) => (
  <img
    alt=""
    className={cn("size-8 shrink-0", className)}
    src="/brand/icon.svg"
  />
);
