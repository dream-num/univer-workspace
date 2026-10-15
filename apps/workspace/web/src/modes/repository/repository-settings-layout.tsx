import type { ReactNode } from "react";
import { RepositoryTabs } from "./repository-tabs";
import { SpaceSettingsNav, type SpaceSettingsSection } from "./settings-nav";

export function RepositorySettingsLayout({
  spaceId,
  current,
  title,
  children,
}: {
  readonly spaceId: string;
  readonly current: SpaceSettingsSection;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <>
      <RepositoryTabs spaceId={spaceId} active="settings" />
      <div className="repository-chrome repository-settings min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
        <div className="mx-auto flex max-w-7xl gap-10 px-8 py-6 max-[767px]:flex-col max-[767px]:gap-6 max-[767px]:px-4">
          <SpaceSettingsNav spaceId={spaceId} current={current} />
          <section className="min-w-0 flex-1" aria-labelledby="settings-heading">
            <h2
              id="settings-heading"
              className="mb-4 border-b border-border pb-2 text-2xl leading-9 font-normal"
            >
              {title}
            </h2>
            {children}
          </section>
        </div>
      </div>
    </>
  );
}
