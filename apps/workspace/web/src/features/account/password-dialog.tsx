import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import { Button, Dialog, DialogClose, Field, PasswordInput, toast } from "../../shared/ui";

export function PasswordDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<{
    current?: string;
    next?: string;
    confirm?: string;
  }>({});
  const changePassword = useMutation({
    mutationFn: async (values: {
      readonly currentPassword: string;
      readonly newPassword: string;
    }) => {
      const { error: apiErr } = await api.PUT("/api/auth/password", {
        body: values,
      });
      if (apiErr) throw apiError(apiErr);
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onOpenChange(false);
      toast.success(t("passwordChanged"));
    },
    onError: (mutationError) => toast.error(mutationError.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (!currentPassword) nextErrors.current = t("enterCurrentPassword");
    if (!newPassword) nextErrors.next = t("enterNewPassword");
    else if (newPassword.length < 8) nextErrors.next = t("passwordMinLength");
    if (confirmPassword !== newPassword) nextErrors.confirm = t("passwordsDoNotMatch");
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    changePassword.mutate({ currentPassword, newPassword });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setErrors({});
        onOpenChange(next);
      }}
      title={t("changePassword")}
      footer={
        <>
          <DialogClose render={<Button variant="secondary">{t("cancel")}</Button>} />
          <Button onClick={submit} disabled={changePassword.isPending}>
            {t("changePassword")}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4" id="password-form">
        <Field label={t("currentPassword")} htmlFor="current-password" error={errors.current}>
          <PasswordInput
            id="current-password"
            autoComplete="current-password"
            value={currentPassword}
            invalid={Boolean(errors.current)}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>
        <Field label={t("newPassword")} htmlFor="new-password" error={errors.next}>
          <PasswordInput
            id="new-password"
            autoComplete="new-password"
            value={newPassword}
            invalid={Boolean(errors.next)}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
        <Field label={t("confirmPassword")} htmlFor="confirm-password" error={errors.confirm}>
          <PasswordInput
            id="confirm-password"
            autoComplete="new-password"
            value={confirmPassword}
            invalid={Boolean(errors.confirm)}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}
