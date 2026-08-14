import { Avatar as BaseAvatar } from "@base-ui/react/avatar";
import { cn } from "../utils/cn";

const avatarSizes = {
  xs: "size-6 text-[10px]",
  sm: "size-7 text-xs",
  md: "size-8 text-[13px]",
  lg: "size-10 text-sm",
} as const;

export function Avatar({
  src,
  name,
  size = "md",
  className,
}: {
  readonly src?: string | null | undefined;
  readonly name: string;
  readonly size?: keyof typeof avatarSizes;
  readonly className?: string;
}) {
  return (
    <BaseAvatar.Root
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 font-semibold text-brand-700 select-none",
        avatarSizes[size],
        className
      )}
    >
      {src ? (
        <BaseAvatar.Image
          src={src}
          alt=""
          className="size-full object-cover"
        />
      ) : null}
      <BaseAvatar.Fallback>
        {name.trim().slice(0, 1).toUpperCase() || "?"}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}
