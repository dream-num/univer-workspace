import type { HTMLAttributes } from "react";
import { cn } from "./cn.js";
import css from "./badge.module.scss";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly variant?: "default" | "brand" | "success" | "warning" | "danger" | "violet" | "outline";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return <span className={cn(css.badge, css[variant], className)} {...props} />;
}
