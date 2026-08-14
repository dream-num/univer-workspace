import { PencilLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../utils/cn";
import { Tooltip } from "./tooltip";

/**
 * Click-to-edit inline text, used for renaming a document from the header.
 */
export function EditableText({
  value,
  onCommit,
  canEdit,
  editLabel,
  className,
}: {
  readonly value: string;
  readonly onCommit: (next: string) => void;
  readonly canEdit?: boolean;
  readonly editLabel?: string;
  readonly className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        aria-label={editLabel}
        className={cn(
          "h-7 max-w-[min(42vw,520px)] rounded-md border border-ring bg-background px-1.5 text-sm font-semibold shadow-xs outline-none ring-2 ring-ring/25",
          className
        )}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <span
      className={cn(
        "group inline-flex max-w-[min(42vw,520px)] items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors",
        canEdit && "cursor-text hover:bg-accent",
        className
      )}
      onClick={() => {
        if (canEdit) {
          setDraft(value);
          setEditing(true);
        }
      }}
    >
      <span className="truncate text-sm font-semibold" title={value}>
        {value}
      </span>
      {canEdit ? (
        <Tooltip content={editLabel ?? ""}>
          <button
            type="button"
            aria-label={editLabel}
            className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              setDraft(value);
              setEditing(true);
            }}
          >
            <PencilLine className="size-3.5" />
          </button>
        </Tooltip>
      ) : null}
    </span>
  );
}
