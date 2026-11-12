import type { ReactNode } from "react";

export interface AgentPageHost {
  readonly renderPage: (content: ReactNode, title: string, spaceId?: string) => ReactNode;
}
