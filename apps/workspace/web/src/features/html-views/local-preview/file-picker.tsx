import type { ReactNode } from "react";
import { Button } from "../../../shared/ui";
import { usePreviewMessages } from "./messages";
import type { usePreviewPage } from "./use-preview-page";

/** A drop target with a button. `pick` opens the browser's file chooser. */
export function FilePicker({ loader, pick, variant = "primary", children }: {
  loader: ReturnType<typeof usePreviewPage>;
  pick: () => void;
  variant?: "primary" | "secondary";
  children?: ReactNode;
}) {
  const m = usePreviewMessages();
  return <div
    className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border p-4 text-sm"
    onDragOver={(event) => event.preventDefault()}
    onDrop={(event) => { event.preventDefault(); void loader.drop(event.dataTransfer.items, event.dataTransfer.files); }}
  >
    <span>{children ?? m.pickDrop}</span>
    <Button variant={variant} onClick={pick}>{m.pickFile}</Button>
  </div>;
}
