import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export interface BreadcrumbItem {
  readonly key: string;
  readonly label: ReactNode;
  readonly href?: ReactNode;
}

export function Breadcrumb({
  items,
  className,
}: {
  readonly items: readonly { readonly label: ReactNode; readonly link?: ReactNode }[];
  readonly className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={index} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <ChevronRight
                  className="size-3.5 shrink-0 text-subtle-foreground"
                  aria-hidden="true"
                />
              ) : null}
              {last || !item.link ? (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cn(
                    "truncate rounded px-1 py-0.5",
                    last
                      ? "font-medium text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {item.label}
                </span>
              ) : (
                <span className="truncate rounded px-1 py-0.5 text-muted-foreground transition-colors hover:text-foreground [&_a]:text-inherit [&_a]:no-underline">
                  {item.link}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
