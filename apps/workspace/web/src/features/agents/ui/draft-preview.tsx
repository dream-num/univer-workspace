import { useEffect, useState } from "react";
import { HtmlView, HtmlViewFile } from "../../html-views";
import { Button } from "../../../shared/ui/button";
import { DialogContent, DialogRoot, DialogTitle } from "../../../shared/ui/dialog";
import { useAgentMessages } from "./messages";

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
  const m = useAgentMessages();
  const [tab, setTab] = useState<"new" | "current">("new");
  useEffect(onOpened, [onOpened]);
  return <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent hideClose className="inset-0 h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0 p-0" aria-describedby={undefined}>
      <header className="agent-draft-header">
        <DialogTitle>{name} · {m.draft}</DialogTitle>
        <div className="agent-approval-actions">
          {replacing && <div role="group" aria-label={m.draftPreview}>
            <Button variant="secondary" className="aria-pressed:bg-accent aria-pressed:text-accent-foreground" aria-pressed={tab === "new"} onClick={() => setTab("new")}>{m.newVersion}</Button>
            <Button variant="secondary" className="aria-pressed:bg-accent aria-pressed:text-accent-foreground" aria-pressed={tab === "current"} onClick={() => setTab("current")}>{m.currentVersion}</Button>
          </div>}
          <Button variant="secondary" onClick={onClose}>{m.back}</Button>
          <Button disabled={disabled} onClick={() => onDecide(true)}>{m.publish}</Button>
          <Button variant="secondary" disabled={disabled} onClick={() => onDecide(false)}>{m.reject}</Button>
        </div>
      </header>
      <div className="agent-draft-body">
        {tab === "new" ? <HtmlView key="new" source={html} draft immersive actionsContainer={null} /> :
          current ? <HtmlViewFile key="current" resource={current} draft immersive actionsContainer={null} /> :
            <p role="status">{currentError ? m.previewUnavailable : m.loading}</p>}
      </div>
    </DialogContent>
  </DialogRoot>;
}
