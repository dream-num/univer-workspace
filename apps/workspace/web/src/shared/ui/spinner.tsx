import { Loader2 } from "lucide-react";
import { cn } from "../utils/cn";

export function Spinner({
  className,
  label,
}: {
  readonly className?: string | undefined;
  readonly label?: string | undefined;
}) {
  return (
    <Loader2
      aria-label={label ?? "Loading"}
      className={cn("size-4 animate-spin text-muted-foreground", className)}
    />
  );
}

export function LoadingScreen({ label }: { readonly label?: string }) {
  return (
    <main className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="size-6 text-brand-600" label={label} />
        {label ? (
          <p className="text-sm text-muted-foreground">{label}</p>
        ) : null}
      </div>
    </main>
  );
}
