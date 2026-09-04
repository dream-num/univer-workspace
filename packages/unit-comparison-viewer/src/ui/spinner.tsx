import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "./cn.js";

export function Spinner({ className }: { readonly className?: string }): ReactElement {
  return (
    <LoaderCircle
      aria-label="loading"
      className={cn("size-7 animate-spin text-foreground/60", className)}
      role="status"
    />
  );
}
