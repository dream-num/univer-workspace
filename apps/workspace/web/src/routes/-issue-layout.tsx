import type { IssuePageProps } from "../modes/page.types";
import { useModeDefinition } from "../modes/registry";

export function IssueRouteLayout(props: IssuePageProps) {
  const { pages } = useModeDefinition();
  return <pages.issues {...props} />;
}
