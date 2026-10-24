import { cn } from "cn";

export const Logo = ({ className }: { className?: string }) => (
  <img
    alt=""
    className={cn("size-8 shrink-0", className)}
    src="/brand/icon.svg"
  />
);
