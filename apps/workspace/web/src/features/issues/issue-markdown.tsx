import { MarkdownViewer } from "@univerjs/univer-workspace-markdown-viewer";
import { useI18n } from "../../shared/i18n";

/** Issue text is user-written Markdown; the shared viewer keeps its safe link and image handling. */
export function IssueMarkdown({ text }: { readonly text: string }) {
  const { language } = useI18n();
  return <MarkdownViewer text={text} locale={language} chrome="none" />;
}
