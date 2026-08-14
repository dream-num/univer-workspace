import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export function Empty({
  icon: Icon = Inbox,
  title,
  description,
  className,
  children,
}: {
  readonly icon?: LucideIcon;
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 px-6 py-14 text-center",
        className
      )}
    >
      <div className="mb-1.5 grid size-11 place-items-center rounded-xl bg-muted text-subtle-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      {title ? (
        <p className="text-sm font-medium text-foreground">{title}</p>
      ) : null}
      {description ? (
        <p className="max-w-72 text-[13px] text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children}
    </div>
  );
}
