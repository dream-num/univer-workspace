import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Star } from "lucide-react";
import { useEffect, useState } from "react";
import type { components } from "../../../../generated/http/schema.js";
import {
  mySpacesQueryOptions,
  starredSpacesQueryOptions,
  useResetSpacePins,
  useSetSpacePins,
} from "../../features/spaces";
import { useI18n } from "../../shared/i18n";
import { Button, Dialog, toast } from "../../shared/ui";
import { RepositoryQueryState } from "./repository-controls";
import { movePin, togglePin } from "./pin-draft";
import { spaceDisplayName } from "./space-name";

export function CustomizePinsDialog({ pins, onClose }: {
  readonly pins: components["schemas"]["SpacePins"];
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const mine = useQuery(mySpacesQueryOptions);
  const starred = useQuery(starredSpacesQueryOptions);
  const save = useSetSpacePins();
  const reset = useResetSpacePins();
  const [ids, setIds] = useState(() => pins.spaces.map((space) => space.id));
  useEffect(() => setIds(pins.spaces.map((space) => space.id)), [pins]);
  const candidates = new Map([
    ...(mine.data?.spaces ?? []).map((space) => [space.id, space] as const),
    ...(starred.data?.spaces ?? []).map((space) => [space.id, space] as const),
  ]);
  const items = [...ids, ...[...candidates.keys()].filter((id) => !ids.includes(id))]
    .flatMap((id) => {
      const space = candidates.get(id);
      return space ? [space] : [];
    });
  const busy = save.isPending || reset.isPending;
  const pending = mine.isPending || starred.isPending;
  const failed = mine.isError || starred.isError;
  const mutationOptions = {
    onSuccess: onClose,
    onError: (error: Error) => toast.error(error.message),
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open && !busy) onClose(); }}
      title={t("repositoryCustomizePins")}
      footer={
        <>
          {pins.customized ? (
            <Button variant="ghost" disabled={busy} onClick={() => reset.mutate(undefined, mutationOptions)}>
              {t("repositoryResetPins")}
            </Button>
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={onClose}>{t("cancel")}</Button>
          <Button disabled={busy || pending || failed || ids.length === 0} onClick={() => save.mutate(ids, mutationOptions)}>
            {t("save")}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
        {t("repositoryPinsCount", { count: ids.length, limit: pins.limit })}
      </p>
      <RepositoryQueryState pending={pending} failed={failed} retry={async () => { await Promise.all([mine.refetch(), starred.refetch()]); }}>
        <ul className="max-h-[55vh] overflow-y-auto">
          {items.map((space) => {
            const index = ids.indexOf(space.id);
            const pinned = index >= 0;
            const name = spaceDisplayName(space, t) ?? space.name;
            return (
              <li key={space.id} className="flex items-center gap-2 border-b border-border py-2">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    checked={pinned}
                    disabled={busy || (!pinned && ids.length >= pins.limit)}
                    onChange={() => setIds(togglePin(ids, space.id, pins.limit))}
                  />
                  <span className="truncate">{name}</span>
                  {space.affiliation === "none" ? <Star className="size-4 shrink-0" aria-label={t("repositoryStarredOnly")} /> : null}
                </label>
                {pinned ? (
                  <>
                    <Button variant="ghost" size="icon" aria-label={t("repositoryMovePinUp", { name })} disabled={busy || index === 0} onClick={() => setIds(movePin(ids, space.id, "up"))}>
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={t("repositoryMovePinDown", { name })} disabled={busy || index === ids.length - 1} onClick={() => setIds(movePin(ids, space.id, "down"))}>
                      <ArrowDown aria-hidden="true" />
                    </Button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      </RepositoryQueryState>
    </Dialog>
  );
}
