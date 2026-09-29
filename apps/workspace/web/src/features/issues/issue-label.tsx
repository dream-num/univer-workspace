import { cn } from "../../shared/utils/cn";

// Full class names so Tailwind can see them; the server stores only the palette key.
const LABEL_CLASSES: Readonly<Record<string, string>> = {
  gray: "border-label-gray/30 bg-label-gray-soft text-label-gray",
  blue: "border-label-blue/30 bg-label-blue-soft text-label-blue",
  green: "border-label-green/30 bg-label-green-soft text-label-green",
  yellow: "border-label-yellow/30 bg-label-yellow-soft text-label-yellow",
  orange: "border-label-orange/30 bg-label-orange-soft text-label-orange",
  red: "border-label-red/30 bg-label-red-soft text-label-red",
  purple: "border-label-purple/30 bg-label-purple-soft text-label-purple",
  pink: "border-label-pink/30 bg-label-pink-soft text-label-pink",
};

export const ISSUE_LABEL_COLORS = Object.keys(LABEL_CLASSES);

export function IssueLabelChip({
  name,
  color,
  className,
}: {
  readonly name: string;
  readonly color: string;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-40 items-center truncate rounded-full border px-2 py-px text-xs font-medium",
        LABEL_CLASSES[color] ?? LABEL_CLASSES["gray"],
        className,
      )}
    >
      {name}
    </span>
  );
}

export function IssueLabelSwatch({ color }: { readonly color: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-3 shrink-0 rounded-full border", LABEL_CLASSES[color] ?? LABEL_CLASSES["gray"])}
    />
  );
}
