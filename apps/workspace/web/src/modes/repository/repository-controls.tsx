import { useNavigate } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useState, type PropsWithChildren } from "react";
import { CreateTeamDialog } from "../../features/spaces";
import { useI18n } from "../../shared/i18n";
import { Button, Input, Skeleton } from "../../shared/ui";

export function RepositoryCreateButton({ compact = false }: { readonly compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { t } = useI18n();
  return (
    <>
      <Button
        className="repository-create-button"
        size={compact ? "sm" : "md"}
        onClick={() => setOpen(true)}
      >
        <Plus aria-hidden="true" />
        {t(compact ? "dashboardNew" : "createTeamSpace")}
      </Button>
      <CreateTeamDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={async ({ id }) => {
          await navigate({ to: "/spaces/$spaceId", params: { spaceId: id } });
        }}
      />
    </>
  );
}

export function RepositorySearchField({
  value,
  onChange,
  label,
  maxLength = 200,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label: string;
  readonly maxLength?: number;
}) {
  return (
    <label className="repository-search">
      <Search aria-hidden="true" className="size-4" />
      <Input
        aria-label={label}
        placeholder={label}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function RepositoryQueryState({
  pending,
  failed,
  retry,
  children,
}: PropsWithChildren<{
  readonly pending: boolean;
  readonly failed: boolean;
  readonly retry: () => unknown;
}>) {
  const { t } = useI18n();
  if (pending)
    return (
      <div role="status" aria-label={t("dashboardLoading")} className="space-y-4 p-5">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  if (failed)
    return (
      <div role="alert" className="repository-empty">
        <p>{t("dashboardLoadFailed")}</p>
        <Button variant="secondary" size="sm" onClick={() => void retry()}>
          {t("repositoryPageRetry")}
        </Button>
      </div>
    );
  return children;
}

export function RepositoryLoadMore({
  hasNext,
  pending,
  failed,
  load,
}: {
  readonly hasNext: boolean;
  readonly pending: boolean;
  readonly failed: boolean;
  readonly load: () => unknown;
}) {
  const { t } = useI18n();
  if (!hasNext && !failed) return null;
  return (
    <div className="repository-load-more">
      {failed ? <p role="alert">{t("dashboardLoadFailed")}</p> : null}
      <Button variant="secondary" disabled={pending} onClick={() => void load()}>
        {t(pending ? "dashboardLoading" : failed ? "repositoryPageRetry" : "dashboardLoadMore")}
      </Button>
    </div>
  );
}
