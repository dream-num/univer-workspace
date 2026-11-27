import { isHtmlViewFilename } from "@univerjs-labs/html-view";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { components } from "../../../../generated/http/schema.js";
import { NodeIcon } from "../nodes/node-icon";
import { spaceNodesQueryOptions } from "../nodes/nodes.queries";
import { useI18n } from "../../shared/i18n";

type AgentSpace = components["schemas"]["AgentSpace"];

const rowClass = "flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground no-underline hover:bg-muted/70";

/** The agent's Spaces. `readable` is false for a signed-in person, who reads them only after taking the agent. */
export function HandoffSpaces({ spaces, readable }: { readonly spaces: readonly AgentSpace[]; readonly readable: boolean }) {
  const { t } = useI18n();
  // A Personal Space stores its name in the language of whoever created it.
  const name = (space: AgentSpace) => (space.type === "personal" ? t("personalSpace") : space.name);
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {spaces.map((space) => (
        <li key={space.id} className="rounded-lg border border-border p-2">
          <div className="flex items-baseline justify-between gap-3 px-2 py-1 text-sm">
            {readable ? (
              <Link to="/spaces/$spaceId" params={{ spaceId: space.id }} search={{}} className="min-w-0 truncate font-medium text-foreground">
                {name(space)}
              </Link>
            ) : (
              <span className="min-w-0 truncate font-medium">{name(space)}</span>
            )}
            <span className="shrink-0 text-muted-foreground">{t("claimAgentFiles", { count: space.files })}</span>
          </div>
          {readable ? <SpaceFiles spaceId={space.id} /> : null}
        </li>
      ))}
    </ul>
  );
}

function SpaceFiles({ spaceId }: { readonly spaceId: string }) {
  const { data } = useQuery(spaceNodesQueryOptions(spaceId));
  return (
    <ul className="m-0 list-none p-0">
      {data?.nodes.map((node) => (
        <li key={node.id}>
          <Link
            to="/nodes/$nodeId"
            params={{ nodeId: node.id }}
            search={node.resource?.kind === "blob" && isHtmlViewFilename(node.name) ? { view: "immersive" } : {}}
            className={rowClass}
          >
            <NodeIcon
              name={node.name}
              kind={node.resource ? "resource" : "group"}
              resourceKind={node.resource?.kind}
              unitType={node.resource?.kind === "univer" ? node.resource.unitType : null}
              mediaType={node.resource?.kind === "blob" ? node.resource.mediaType : null}
            />
            <span className="truncate">{node.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
