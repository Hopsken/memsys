import { cn } from "@/lib/utils";

const Skeleton = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="skeleton"
    className={cn("bg-accent rounded-md motion-safe:animate-pulse", className)}
    {...props}
  />
);

export { Skeleton };
