import { useEffect, useState } from "react";
import { HtmlView, HtmlViewFile } from "../html-view";
import { Button } from "../../../shared/ui/button";
import { DialogContent, DialogRoot, DialogTitle } from "../../../shared/ui/dialog";
import { useDraftMessages } from "./messages";
import "./draft-preview.css";

export function DraftPreview({ html, name, replacing, current, currentError, disabled, onOpened, onClose, onDecide }: {
  readonly html: string;
  readonly name: string;
  readonly replacing: boolean;
  readonly current: { contentUrl: string; byteSize: number } | undefined;
  readonly currentError: boolean;
  readonly disabled: boolean;
  readonly onOpened: () => void;
  readonly onClose: () => void;
  readonly onDecide: (approved: boolean) => void;
}) {
  const m = useDraftMessages();
  useEffect(onOpened, [onOpened]);
  return <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent hideClose className="inset-0 h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0 p-0" aria-describedby={undefined}>
      <header className="agent-draft-header">
        <DialogTitle>{name} · {m.draft}</DialogTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={onClose}>{m.back}</Button>
          <Button disabled={disabled} onClick={() => onDecide(true)}>{m.publish}</Button>
          <Button variant="secondary" disabled={disabled} onClick={() => onDecide(false)}>{m.reject}</Button>
        </div>
      </header>
      <DraftVersions html={html} replacing={replacing} current={current} currentError={currentError} />
    </DialogContent>
  </DialogRoot>;
}

export function DraftVersions({ html, replacing, current, currentError }: {
  readonly html: string;
  readonly replacing: boolean;
  readonly current: { contentUrl: string; byteSize: number } | undefined;
  readonly currentError: boolean;
}) {
  const m = useDraftMessages();
  const [tab, setTab] = useState<"new" | "current">("new");
  return <div className="flex min-h-0 flex-1 flex-col">
    {replacing && <div className="flex shrink-0 gap-2 border-b border-border px-5 py-2" role="group" aria-label={m.draftPreview}>
      <Button variant="secondary" className="aria-pressed:bg-accent aria-pressed:text-accent-foreground" aria-pressed={tab === "new"} onClick={() => setTab("new")}>{m.newVersion}</Button>
      <Button variant="secondary" className="aria-pressed:bg-accent aria-pressed:text-accent-foreground" aria-pressed={tab === "current"} onClick={() => setTab("current")}>{m.currentVersion}</Button>
    </div>}
    <div className="agent-draft-body">
      {tab === "new" ? <HtmlView key="new" source={html} draft immersive actionsContainer={null} /> :
        current ? <HtmlViewFile key="current" resource={current} draft immersive actionsContainer={null} /> :
          <p role="status">{currentError ? m.previewUnavailable : m.loading}</p>}
    </div>
  </div>;
}
