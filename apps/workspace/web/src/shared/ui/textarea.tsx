import type { TextareaHTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly invalid?: boolean | undefined;
}

export function Textarea({ className, invalid, ...props }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        "min-h-24 w-full min-w-0 resize-y rounded-md border bg-background px-3 py-2 text-sm leading-6 text-foreground shadow-xs outline-none transition-[border-color,box-shadow]",
        "placeholder:text-subtle-foreground",
        "hover:border-border-strong",
        "focus:border-ring focus:ring-2 focus:ring-ring/25",
        "disabled:cursor-not-allowed disabled:opacity-50",
        invalid
          ? "border-destructive focus:border-destructive focus:ring-destructive/20"
          : "border-input",
        className,
      )}
      {...props}
    />
  );
}
