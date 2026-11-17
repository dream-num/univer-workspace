import { Bot } from "lucide-react";
import { useI18n } from "../../shared/i18n";
import { Button, toast } from "../../shared/ui";
import { resourceShareUrl } from "../resource-view/resource-view";

// English whatever the UI language, because agents follow English instructions best.
export function handToAgentPrompt(origin: string, nodeId: string): string {
  const link = resourceShareUrl(origin, nodeId, "standard");
  return `Read this Univer Workspace file, then do what I ask: ${link}

Use the uvw CLI:
npm install --global univer-workspace-cli@latest
uvw config set workspace.origin ${origin}
uvw auth guest
uvw read A1:J50 --unit ${link} --trunk

That reads a Sheet. For a Doc or a Slide, run one of these instead:
uvw inspect document --unit ${link} --trunk
uvw inspect presentation --unit ${link} --trunk

With MCP, you can instead connect to ${origin}/mcp and call \`read\` (\`inspect\` for a Doc or Slide) with the link as \`unit\` and \`trunk: true\`. If it has no \`read\` tool, use the CLI.`;
}

export async function copyHandToAgentPrompt(nodeId: string, t: ReturnType<typeof useI18n>["t"]): Promise<void> {
  try {
    await navigator.clipboard.writeText(handToAgentPrompt(window.location.origin, nodeId));
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
