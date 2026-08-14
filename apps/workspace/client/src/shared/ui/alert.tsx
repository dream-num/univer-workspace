import { cva, type VariantProps } from "class-variance-authority";
import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn";

const alertVariants = cva(
  "flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        info: "border-brand-200 bg-info-soft text-info-soft-foreground [&_svg]:text-brand-600",
        success:
          "border-success/25 bg-success-soft text-success-soft-foreground [&_svg]:text-success",
        warning:
          "border-warning/30 bg-warning-soft text-warning-soft-foreground [&_svg]:text-warning",
        destructive:
          "border-destructive/25 bg-destructive-soft text-destructive-soft-foreground [&_svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  }
);

const alertIcons: Record<string, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  destructive: CircleAlert,
};

export interface AlertProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof alertVariants> {
  readonly title?: ReactNode;
}

export function Alert({
  className,
  variant = "info",
  title,
  children,
  ...props
}: AlertProps) {
  const Icon = alertIcons[variant ?? "info"] ?? Info;
  return (
    <div
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? (
          <div className={cn(title && "mt-0.5", "text-[13px] opacity-90")}>
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
