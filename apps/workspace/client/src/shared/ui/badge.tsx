import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../utils/cn";

const badgeVariants = cva(
  [
    "inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5",
    "text-xs font-medium whitespace-nowrap",
    "[&_svg]:size-3 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        default: "border-transparent bg-muted text-muted-foreground",
        brand: "border-transparent bg-brand-50 text-brand-700",
        success:
          "border-transparent bg-success-soft text-success-soft-foreground",
        warning:
          "border-transparent bg-warning-soft text-warning-soft-foreground",
        danger:
          "border-transparent bg-destructive-soft text-destructive-soft-foreground",
        violet: "border-transparent bg-board-soft text-board",
        outline: "border-border text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
