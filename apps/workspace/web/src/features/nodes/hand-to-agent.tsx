import { Bot } from "lucide-react";
import { useI18n } from "../../shared/i18n";
import { Button, toast } from "../../shared/ui";
import { resourceShareUrl } from "../resource-view/resource-view";

// English whatever the UI language, because agents follow English instructions best.
export function handToAgentPrompt(origin: string, nodeId: string): string {
  const link = resourceShareUrl(origin, nodeId, "standard");
  return `Read this Univer Workspace file, then do what I ask: ${link}

With MCP: connect to ${origin}/mcp, then call \`read\` with the link as \`unit\`, \`trunk: true\` and a range such as A1:J50.

Without MCP, use the CLI:
npm install --global univer-workspace-cli@latest
uvw config set workspace.origin ${origin}
uvw auth guest
uvw read A1:J50 --unit ${link} --trunk

For a Doc or Slide, use \`inspect\` instead of \`read\`.`;
}

export function HandToAgentButton({ nodeId }: { readonly nodeId: string }) {
  const { t } = useI18n();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="max-sm:px-2"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(handToAgentPrompt(window.location.origin, nodeId));
          toast.success(t("handToAgentCopied"));
        } catch {
          toast.error(t("handToAgentCopyFailed"));
        }
      }}
    >
      <Bot aria-hidden="true" />
      <span className="max-sm:sr-only">{t("handToMyAgent")}</span>
    </Button>
  );
}
