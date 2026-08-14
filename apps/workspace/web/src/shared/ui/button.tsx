import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../utils/cn";

const buttonVariants = cva(
  [
    "inline-flex cursor-pointer items-center justify-center gap-1.5",
    "whitespace-nowrap rounded-md text-sm font-medium select-none",
    "transition-colors outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring/40",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-brand-800",
        secondary:
          "border border-input bg-background text-secondary-foreground shadow-xs hover:bg-accent hover:text-accent-foreground",
        ghost: "text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive-hover",
        "destructive-ghost":
          "text-destructive hover:bg-destructive-soft",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-3.5",
        lg: "h-11 px-4 text-[15px]",
        icon: "size-8",
        "icon-sm": "size-7 [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
