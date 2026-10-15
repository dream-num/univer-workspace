import { useState } from "react";
import { useI18n } from "../../shared/i18n";
import { Button, DialogContent, DialogFooter, DialogHeader, DialogRoot, DialogTitle } from "../../shared/ui";

const SELF_HOST_REPOSITORY_URL = "https://github.com/dream-num/univer-workspace";

export function TrialNoticeDialog({ userId }: { readonly userId: string }) {
  const { t } = useI18n();
  const storageKey = `univer-workspace-trial-notice-acknowledged:${userId}`;
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey) === null;
    } catch {
      return true;
    }
  });
  const acknowledge = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(storageKey, "true");
    } catch {
      // Without storage the notice returns on the next page load.
    }
  };

  return (
    <DialogRoot open={open} disablePointerDismissal onOpenChange={() => undefined}>
      <DialogContent width="md" hideClose>
        <DialogHeader>
          <DialogTitle>{t("trialNoticeTitle")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2 text-sm text-secondary-foreground">
          <p className="m-0">{t("trialNoticeBody")}</p>
          <p className="m-0">
            {t("trialNoticeSelfHost")}
            <a
              href={SELF_HOST_REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-brand-700 underline"
            >
              {SELF_HOST_REPOSITORY_URL}
            </a>
          </p>
        </div>
        <DialogFooter>
          <Button onClick={acknowledge}>{t("trialNoticeAcknowledge")}</Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
