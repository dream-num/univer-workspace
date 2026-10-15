import { cn } from "../../shared/utils/cn";

export function BreadcrumbSeparator({ className }: { readonly className: string | undefined }) {
  return (
    <span aria-hidden="true" className={cn("shrink-0 text-muted-foreground/60", className)}>
      /
    </span>
  );
}
