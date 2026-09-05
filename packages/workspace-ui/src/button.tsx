import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn.js";
import css from "./button.module.scss";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?:
    | "primary"
    | "success"
    | "secondary"
    | "ghost"
    | "destructive"
    | "destructive-ghost"
    | "link";
  readonly size?: "sm" | "md" | "lg" | "icon" | "icon-sm";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(css.button, css[variant], css[size], className)}
      {...props}
    />
  );
});
