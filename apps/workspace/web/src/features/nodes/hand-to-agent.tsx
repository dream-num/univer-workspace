import { Bot, Copy } from "lucide-react";
import { useState } from "react";
import { useI18n, type MessageKey } from "../../shared/i18n";
import { Button, Dialog, Segmented, toast } from "../../shared/ui";
import { resourceShareUrl } from "../resource-view/resource-view";

export type AgentTask = "read" | "copy";

// The first is recommended and selected by default.
export const HAND_OFFS = ["mcp", "cli"] as const;
export type HandOff = (typeof HAND_OFFS)[number];

const TASKS: Record<AgentTask, {
  readonly ask: string;
  readonly cli: (link: string) => string;
  readonly mcp: string;
  readonly mcpSteps: string;
}> = {
  read: {
    ask: "Read this Univer Workspace file, then do what I ask",
    cli: (link) => `uvw read A1:J50 --unit ${link} --trunk

That reads a Sheet. For a Doc or a Slide, run one of these instead:
uvw inspect document --unit ${link} --trunk
uvw inspect presentation --unit ${link} --trunk`,
    mcp: "call `read` (`inspect` for a Doc or Slide) with the link as `unit` and `trunk: true`. If it has no `read` tool, use the CLI.",
    mcpSteps: `Call \`read\` with the link as \`unit\`, \`trunk: true\` and the range A1:J50. That reads a Sheet. For a Doc or a Slide, call \`inspect\` with the link as \`unit\`, \`trunk: true\` and \`target\` set to \`document\` or \`presentation\`.
If you have no \`read\` or \`inspect\` tool, this server does not let you read file contents. Tell me so, and that the Command line (uvw) option of Hand to my agent can read it.`,
  },
  copy: {
    ask: "Make me a copy of this Univer Workspace file that I can edit",
    cli: (link) => `uvw pr create -R <repo> -t "My copy" --json
uvw unit create --worktree <id> --space <repo> --type sheet --name "My copy" --from ${link} --json
uvw pr ready <id> --json
uvw pr merge <id> --json
uvw claim

<repo> is the Personal Space repository that auth guest prints, and <id> is the id that pr create returns. That copies a Sheet. For a Doc or a Slide, use --type doc or --type slide. Then give me the claim link: when I sign in and open it, the copy is mine.`,
    mcp: "call `pr_create`, `unit_create` with the link as `from`, `pr_ready`, `pr_merge` and `claim`. If `unit_create` has no `from`, use the CLI.",
    mcpSteps: `1. Call \`repo_list\` to find your Personal Space repository, then \`pr_create\` in it with the title "My copy".
2. Call \`unit_create\` with that pull request's id as \`worktree\`, the repository as \`space\`, \`type\` sheet, the name "My copy" and the link as \`from\`. If the file is a Doc or a Slide, the error says so: use \`type\` doc or slide.
3. Call \`pr_ready\`, then \`pr_merge\`. If you have no \`pr_merge\`, give me the pull request link to merge.
4. If you have a \`claim\` tool, call it and give me the claim link: when I sign in and open it, the copy is mine.
You do not need \`read\` for this. If \`unit_create\` has no \`from\`, tell me to use the Command line (uvw) option of Hand to my agent.`,
  },
};

export function mcpServerUrl(origin: string): string {
  return `${origin}/mcp`;
}

// English whatever the UI language, because agents follow English instructions best.
export function handToAgentPrompt(origin: string, nodeId: string, task: AgentTask, way: HandOff): string {
  const link = resourceShareUrl(origin, nodeId, "standard");
  const { ask, cli, mcp, mcpSteps } = TASKS[task];
  if (way === "mcp") {
    return `${ask}: ${link}

Use the Univer Workspace MCP server ${mcpServerUrl(origin)}. If you are not connected to it, ask me to add it, then try again.
${mcpSteps}`;
  }
  return `${ask}: ${link}

Use the uvw CLI:
npm install --global univer-workspace-cli@latest
uvw config set workspace.origin ${origin}
uvw auth guest
${cli(link)}

With MCP, you can instead connect to ${mcpServerUrl(origin)} and ${mcp}`;
}

async function copyText(text: string, t: ReturnType<typeof useI18n>["t"], copied: MessageKey): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t(copied));
  } catch {
    toast.error(t("handToAgentCopyFailed"));
  }
}

export function copyHandToAgentPrompt(nodeId: string, t: ReturnType<typeof useI18n>["t"], task: AgentTask, way: HandOff): Promise<void> {
  return copyText(handToAgentPrompt(window.location.origin, nodeId, task, way), t, "handToAgentCopied");
}

export function HandToAgentChoice({ nodeId, task, way, onWayChange }: {
  readonly nodeId: string;
  readonly task: AgentTask;
  readonly way: HandOff;
  readonly onWayChange: (way: HandOff) => void;
}) {
  const { t } = useI18n();
  const url = mcpServerUrl(window.location.origin);
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm">
      <Segmented
        aria-label={t("handToAgentWay")}
        size="sm"
        className="self-start"
        value={way}
        onValueChange={onWayChange}
        options={HAND_OFFS.map((value) => ({ value, label: t(value === "mcp" ? "handToAgentMcp" : "handToAgentCli") }))}
      />
      {way === "mcp" ? (
        <>
          <p>{t("handToAgentMcpServer")}</p>
          <div className="flex items-center gap-1 rounded-md bg-muted py-1 pr-1 pl-3">
            <code className="min-w-0 flex-1 text-xs break-all">{url}</code>
            <Button variant="ghost" size="icon-sm" aria-label={t("handToAgentCopyServer")} onClick={() => copyText(url, t, "handToAgentServerCopied")}>
              <Copy aria-hidden="true" />
            </Button>
          </div>
          <p>{t("handToAgentMcpPrompt")}</p>
        </>
      ) : (
        <p>{t("handToAgentCliPrompt")}</p>
      )}
      <pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all">
        {handToAgentPrompt(window.location.origin, nodeId, task, way)}
      </pre>
      {way === "mcp" ? <p className="text-xs text-muted-foreground">{t("handToAgentSignIn", { label: t("continueAsGuestAgent") })}</p> : null}
    </div>
  );
}

export function HandToAgentButton({ nodeId }: { readonly nodeId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [way, setWay] = useState<HandOff>(HAND_OFFS[0]);
  return (
    <>
      <Button variant="ghost" size="sm" className="max-sm:px-2" onClick={() => setOpen(true)}>
        <Bot aria-hidden="true" />
        <span className="max-sm:sr-only">{t("handToMyAgent")}</span>
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("handToMyAgent")}
        description={t("handToAgentDescription")}
        footer={
          <Button onClick={() => copyHandToAgentPrompt(nodeId, t, "read", way)}>
            <Copy aria-hidden="true" />
            {t("handToAgentCopyPrompt")}
          </Button>
        }
      >
        <HandToAgentChoice nodeId={nodeId} task="read" way={way} onWayChange={setWay} />
      </Dialog>
    </>
  );
}
