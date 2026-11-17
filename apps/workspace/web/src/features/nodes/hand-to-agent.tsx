import { Bot } from "lucide-react";
import { useI18n } from "../../shared/i18n";
import { Button, toast } from "../../shared/ui";
import { resourceShareUrl } from "../resource-view/resource-view";

export type AgentTask = "read" | "copy";

const TASKS: Record<AgentTask, { readonly ask: string; readonly cli: (link: string) => string; readonly mcp: string }> = {
  read: {
    ask: "Read this Univer Workspace file, then do what I ask",
    cli: (link) => `uvw read A1:J50 --unit ${link} --trunk

That reads a Sheet. For a Doc or a Slide, run one of these instead:
uvw inspect document --unit ${link} --trunk
uvw inspect presentation --unit ${link} --trunk`,
    mcp: "call `read` (`inspect` for a Doc or Slide) with the link as `unit` and `trunk: true`. If it has no `read` tool, use the CLI.",
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
  },
};

// English whatever the UI language, because agents follow English instructions best.
export function handToAgentPrompt(origin: string, nodeId: string, task: AgentTask = "read"): string {
  const link = resourceShareUrl(origin, nodeId, "standard");
  const { ask, cli, mcp } = TASKS[task];
  return `${ask}: ${link}

Use the uvw CLI:
npm install --global univer-workspace-cli@latest
uvw config set workspace.origin ${origin}
uvw auth guest
${cli(link)}

With MCP, you can instead connect to ${origin}/mcp and ${mcp}`;
}

export async function copyHandToAgentPrompt(nodeId: string, t: ReturnType<typeof useI18n>["t"], task: AgentTask = "read"): Promise<void> {
  try {
    await navigator.clipboard.writeText(handToAgentPrompt(window.location.origin, nodeId, task));
    toast.success(t("handToAgentCopied"));
  } catch {
    toast.error(t("handToAgentCopyFailed"));
  }
}

export function HandToAgentButton({ nodeId }: { readonly nodeId: string }) {
  const { t } = useI18n();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="max-sm:px-2"
      onClick={() => copyHandToAgentPrompt(nodeId, t)}
    >
      <Bot aria-hidden="true" />
      <span className="max-sm:sr-only">{t("handToMyAgent")}</span>
    </Button>
  );
}
