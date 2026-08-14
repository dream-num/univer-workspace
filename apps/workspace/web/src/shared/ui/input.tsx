import { Eye, EyeOff } from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly invalid?: boolean | undefined;
}

export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm text-foreground shadow-xs outline-none transition-[border-color,box-shadow]",
        "placeholder:text-subtle-foreground",
        "hover:border-border-strong",
        "focus:border-ring focus:ring-2 focus:ring-ring/25",
        "disabled:cursor-not-allowed disabled:opacity-50",
        invalid
          ? "border-destructive focus:border-destructive focus:ring-destructive/20"
          : "border-input",
        className
      )}
      {...props}
    />
  );
}

export function PasswordInput({
  className,
  invalid,
  ...props
}: InputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        className={cn("pr-9", className)}
        invalid={invalid}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center text-subtle-foreground transition-colors hover:text-muted-foreground"
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
