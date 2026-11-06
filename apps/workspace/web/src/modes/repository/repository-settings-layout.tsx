import type { ReactNode } from "react";
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
      <div className="repository-chrome repository-settings min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
        <div className="rd-settings-grid">
          <SpaceSettingsNav spaceId={spaceId} current={current} />
          <section className="min-w-0 flex-1" aria-labelledby="settings-heading">
            <h2
              id="settings-heading"
              className="rd-settings-heading"
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
