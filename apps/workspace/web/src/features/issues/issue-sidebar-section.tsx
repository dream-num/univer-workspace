import type { ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { useI18n } from "../../shared/i18n";
import { Button } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";

export function SidebarSection({
  title,
  onEdit,
  className,
  children,
}: {
  readonly title: string;
  readonly onEdit?: (() => void) | undefined;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section className={cn("grid gap-2 border-b border-border pb-4 last:border-b-0", className)}>
      <h3 className="m-0 flex items-center justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
        {onEdit ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("issueEditSection", { name: title })}
            onClick={onEdit}
          >
            <Settings2 />
          </Button>
        ) : null}
      </h3>
      {children}
    </section>
  );
}

export function Muted({ children }: { readonly children: ReactNode }) {
  return <p className="m-0 text-sm text-muted-foreground">{children}</p>;
}

