import { Link } from "@tanstack/react-router";
import { type ReactElement } from "react";
import { Tooltip } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";

export function NavLink({
  to,
  params,
  selected,
  collapsed,
  search,
  icon,
  label,
  badge,
  badgeTitle,
}: {
  readonly to: string;
  readonly params?: Record<string, string>;
  readonly selected: boolean;
  readonly collapsed: boolean;
  readonly search?: Record<string, string>;
  readonly icon: ReactElement;
  readonly label: string;
  readonly badge?: number;
  readonly badgeTitle?: string;
}) {
  const link = (
    <Link
      to={to}
      {...(params ? { params } : {})}
      {...(search ? { search } : {})}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        collapsed ? "h-11 justify-center px-0 md:h-10" : "h-11 px-2.5 md:h-9",
        selected
          ? "bg-brand-50 font-medium text-brand-700"
          : "text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        selected ? "[&_svg]:text-brand-600" : "[&_svg]:text-muted-foreground",
      )}
    >
      {icon}
      {collapsed ? null : <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && badge !== undefined && badge > 0 ? (
        <span
          title={badgeTitle}
          className="grid h-4.5 min-w-4.5 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
  if (collapsed) {
    return (
      <Tooltip side="right" content={label}>
        {link}
      </Tooltip>
    );
  }
  return link;
}
