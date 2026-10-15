import type { IssuePageProps } from "../modes/registry";
import { useModeDefinition } from "../modes/registry";

export function IssueRouteLayout(props: IssuePageProps) {
  const { pages } = useModeDefinition();
  return <pages.issues {...props} />;
}
