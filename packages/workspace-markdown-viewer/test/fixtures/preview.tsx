import { useState, version } from "react";
import { createRoot } from "react-dom/client";
import { LanguageProvider } from "../../../../apps/workspace/web/src/shared/i18n";
import { MarkdownPreview } from "../../../../apps/workspace/web/src/features/blobs/markdown-preview";
import { WorkspaceMarkdownPreview } from "../../../dsh-univer-workspace-plugin/src/client/components/WorkspaceMarkdownPreview";
import "./preview.css";

declare const __MARKDOWN_HOST__: "agent" | "browser";
const sample = `# Markdown 预览\n\n中文内容与 **加粗**、*斜体*、~~删除线~~。 [跳到结果](#结果)\n\n> 这是引用内容，支持深浅色主题。\n\n| 功能 | 状态 |\n| --- | --- |\n| 表格 | 已支持 |\n| 源码切换 | 已支持 |\n\n- [x] 只读任务\n- [ ] 待办项目\n\n\`\`\`typescript\nconst message = "你好，Workspace!";\nconsole.log(message);\n\`\`\`\n\n[外链](https://example.org) [相对文件](../notes.md)\n\n![示例](https://example.org/image.png)\n\n脚注引用[^1]\n\n## 结果\n\n保持原始文件，不改变文档内容。\n\n[^1]: 脚注说明。\n\n<script>alert("bad")</script>`;
const samples: Record<string, string> = {
  normal: sample,
  empty: "",
  large: "# 大文件全文预览\n" + "中文 ".repeat(50000) + "\n\n## 文件末尾",
  binary: "bad\0data",
  error: "",
};
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const request = new Request(new URL(String(input), location.href), init);
  if (!new URL(request.url).pathname.startsWith("/fixture-content/"))
    return originalFetch(input, init);
  const key = new URL(request.url).pathname.split("/").pop()!;
  if (key === "error") return new Response("Forbidden", { status: 403 });
  const bytes = new TextEncoder().encode(samples[key]);
  return new Response(bytes);
};
function Fixture() {
  const [selected, setSelected] = useState("normal");
  const [dark, setDark] = useState(false);
  const text = samples[selected]!;
  const resource = {
    name: "README.md",
    originalFilename: "README.md",
    mediaType: "text/plain",
    byteSize: selected === "error" ? 1 : new TextEncoder().encode(text).length,
    contentUrl: `/fixture-content/${selected}`,
    downloadUrl: `/fixture-content/${selected}`,
  };
  return (
    <main data-dark={dark}>
      <header>
        <strong>
          {__MARKDOWN_HOST__} · React {version}
        </strong>
        <select aria-label="Fixture" value={selected} onChange={(e) => setSelected(e.target.value)}>
          {Object.keys(samples).map((key) => (
            <option key={key}>{key}</option>
          ))}
        </select>
        <button onClick={() => setDark(!dark)}>Light / Dark</button>
      </header>
      <section>
        {__MARKDOWN_HOST__ === "browser" ? (
          <MarkdownPreview key={selected} resource={resource} />
        ) : (
          <WorkspaceMarkdownPreview
            key={selected}
            {...resource}
            locale="zh-CN"
            t={(key) =>
              ({
                "blob.loading": "加载中",
                "blob.markdownFailed": "读取失败",
                "blob.download": "下载",
              })[key as "blob.loading"] ?? key
            }
          />
        )}
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <LanguageProvider>
    <Fixture />
  </LanguageProvider>,
);
