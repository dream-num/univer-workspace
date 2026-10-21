import { useState, type FormEvent } from "react";
import { useCreateTeamSpace } from "./spaces.commands";
import { useI18n } from "../../shared/i18n";
import { ApiError } from "../../shared/api/errors";
import { Button, Dialog, DialogClose, Field, Input, toast } from "../../shared/ui";
import { isValidSlug, suggestSlug } from "./space-slug";

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
  const [slug, setSlug] = useState("");
  // Follows the name until the user edits it; empty lets the server generate one.
  const [slugEdited, setSlugEdited] = useState(false);
  const [publicRead, setPublicRead] = useState(false);
  const [error, setError] = useState<string>();
  const [slugError, setSlugError] = useState<string>();
  const createTeam = useCreateTeamSpace();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError(t("enterSpaceName"));
      return;
    }
    const trimmedSlug = slug.trim();
    if (trimmedSlug && !isValidSlug(trimmedSlug)) {
      setSlugError(t("spaceSlugInvalid"));
      return;
    }
    createTeam.mutate({ name: name.trim(), publicRead, ...(trimmedSlug ? { slug: trimmedSlug } : {}) }, {
      onSuccess: async (space) => {
        onOpenChange(false);
        setName("");
        setSlug("");
        setSlugEdited(false);
        setPublicRead(false);
        await onCreated(space);
      },
      onError: (mutationError) => {
        if (mutationError instanceof ApiError && mutationError.field === "slug") {
          setSlugError(
            mutationError.code === "SPACE_SLUG_TAKEN" ? t("spaceSlugTaken") : mutationError.message,
          );
          return;
        }
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
        setSlugError(undefined);
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
              setSlugError(undefined);
              setName(event.target.value);
              if (!slugEdited) setSlug(suggestSlug(event.target.value));
            }}
          />
        </Field>
        <Field
          label={t("spaceSlug")}
          htmlFor="team-space-slug"
          className="mt-4"
          error={slugError}
          hint={t("spaceSlugHint")}
        >
          <Input
            id="team-space-slug"
            maxLength={100}
            value={slug}
            invalid={Boolean(slugError)}
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => {
              setSlugError(undefined);
              setSlugEdited(true);
              setSlug(event.target.value);
            }}
            onBlur={() => {
              if (slug.trim() && !isValidSlug(slug.trim())) setSlugError(t("spaceSlugInvalid"));
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
