import { useState, type FormEvent } from "react";
import { useCreateTeamSpace } from "./spaces.commands";
import { useI18n } from "../../shared/i18n";
import { Button, Dialog, DialogClose, Field, Input, toast } from "../../shared/ui";

export function CreateTeamDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreated: (space: { readonly id: string }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [publicRead, setPublicRead] = useState(false);
  const [error, setError] = useState<string>();
  const createTeam = useCreateTeamSpace();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError(t("enterSpaceName"));
      return;
    }
    createTeam.mutate({ name: name.trim(), publicRead }, {
      onSuccess: async (space) => {
        onOpenChange(false);
        setName("");
        setPublicRead(false);
        await onCreated(space);
      },
      onError: (mutationError) => {
        toast.error(
          mutationError instanceof Error ? mutationError.message : t("spaceCreationFailed"),
        );
      },
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setError(undefined);
        onOpenChange(next);
      }}
      title={t("createTeamSpace")}
      footer={
        <>
          <DialogClose render={<Button variant="secondary">{t("cancel")}</Button>} />
          <Button onClick={submit} disabled={createTeam.isPending}>
            {createTeam.isPending ? "…" : t("create")}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} id="create-team-form">
        <Field label={t("spaceName")} htmlFor="team-space-name" error={error}>
          <Input
            id="team-space-name"
            autoFocus
            maxLength={100}
            value={name}
            invalid={Boolean(error)}
            onChange={(event) => {
              setError(undefined);
              setName(event.target.value);
            }}
          />
        </Field>
        <label className="mt-4 flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border p-4">
          <span className="grid gap-1">
            <span className="text-sm font-medium text-foreground">{t("publicRead")}</span>
            <span className="text-sm text-subtle-foreground">{t("publicReadDescription")}</span>
          </span>
          <input
            className="mt-0.5 size-4 accent-primary"
            type="checkbox"
            checked={publicRead}
            onChange={(event) => setPublicRead(event.target.checked)}
          />
        </label>
      </form>
    </Dialog>
  );
}
