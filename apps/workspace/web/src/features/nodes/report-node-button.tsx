import { useMutation } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import { Button, Dialog, DialogClose, Field, Textarea, toast } from "../../shared/ui";

export function ReportNodeButton({ nodeId }: { readonly nodeId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const report = useMutation({
    mutationFn: async (text: string) => {
      const { error } = await api.POST("/api/nodes/{nodeId}/reports", {
        params: { path: { nodeId } },
        body: { reason: text },
      });
      if (error) throw apiError(error);
    },
    onSuccess: () => {
      setOpen(false);
      setReason("");
      toast.success(t("reportSent"));
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim()) report.mutate(reason.trim());
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Flag aria-hidden="true" />
        {t("reportFile")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          report.reset();
        }}
        width="sm"
        title={t("reportFileTitle")}
        description={t("reportFileDescription")}
        footer={
          <>
            <DialogClose render={<Button variant="secondary">{t("cancel")}</Button>} />
            <Button type="submit" form="report-node-form" disabled={!reason.trim() || report.isPending}>
              {t("sendReport")}
            </Button>
          </>
        }
      >
        <form id="report-node-form" onSubmit={submit}>
          <Field
            label={t("reportReason")}
            htmlFor="report-node-reason"
            required
            error={report.isError ? t("reportFailed") : undefined}
          >
            <Textarea
              id="report-node-reason"
              required
              maxLength={1000}
              placeholder={t("reportReasonPlaceholder")}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </form>
      </Dialog>
    </>
  );
}
