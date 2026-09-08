import type { InputHTMLAttributes } from "react";
import { cn } from "./cn.js";
import css from "./input.module.scss";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly invalid?: boolean;
}

export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(css.input, invalid && css.invalid, className)}
      {...props}
    />
  );
}
