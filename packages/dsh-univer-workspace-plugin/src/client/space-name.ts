import type { WorkspaceSnapshot, WorkspaceSource } from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { WorkspaceSpace } from "./workspace-contract.ts";

/** Only the server-generated personal-space pattern is presentation copy. */
export function localizedSpaceName(
  space: Pick<WorkspaceSpace, "type" | "name">,
  template: string,
): string {
  const owner = space.type === "personal" ? /^(.*) 的个人空间$/u.exec(space.name)?.[1] : undefined;
  return owner ? template.replace("{name}", () => owner) : space.name;
}

/**
 * DSH currently renders Workspace titles without a title-rendering slot.
 * Project linked default names at its public browser source; never rename the
 * persisted Space or DSH registry. Replace this adapter when DSH exposes a
 * presentation hook for Workspace titles.
 */
export function localizeWorkspaceNames(
  source: WorkspaceSource,
  getSpaces: () => readonly WorkspaceSpace[],
  getTemplate: () => string,
  subscribeLocale: (listener: () => void) => () => void,
): { invalidate: () => void; dispose: () => void } {
  const getSnapshot = source.getSnapshot;
  const subscribe = source.subscribe;
  const listeners = new Set<() => void>();
  let previous: WorkspaceSnapshot | undefined;
  let projected: WorkspaceSnapshot | undefined;
  const invalidate = () => {
    previous = undefined;
    for (const listener of listeners) listener();
  };
  source.getSnapshot = () => {
    const snapshot = getSnapshot.call(source);
    if (snapshot !== previous) {
      const spaces = new Map(getSpaces().filter(space => space.dshWorkspaceId !== undefined)
        .map(space => [space.dshWorkspaceId, space]));
      const template = getTemplate();
      projected = {
        ...snapshot,
        items: snapshot.items.map(item => {
          const space = spaces.get(String(item.workspaceId));
          if (!space || item.title !== space.name) return item;
          const title = localizedSpaceName(space, template);
          return title === item.title ? item : { ...item, title };
        }),
      };
      previous = snapshot;
    }
    return projected!;
  };
  source.subscribe = (listener) => {
    listeners.add(listener);
    const unsubscribe = subscribe.call(source, listener);
    return () => { listeners.delete(listener); unsubscribe(); };
  };
  const unsubscribeLocale = subscribeLocale(invalidate);
  return {
    invalidate,
    dispose: () => {
      unsubscribeLocale();
      source.getSnapshot = getSnapshot;
      source.subscribe = subscribe;
      invalidate();
      listeners.clear();
    },
  };
}
