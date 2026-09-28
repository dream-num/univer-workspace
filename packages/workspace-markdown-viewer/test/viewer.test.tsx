import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownViewer } from "../src/index.js";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function render(text: string) {
  act(() => root.render(<MarkdownViewer text={text} locale="zh-CN" />));
}
function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

describe("Markdown viewer", () => {
  it("renders GFM with read-only tasks and preserves exact source on toggle", () => {
    const text =
      "# 标题\n\n| 名称 | 值 |\n| --- | --- |\n| 中文 | 42 |\n\n- [x] 完成\n\n~~删除~~\n\n```ts\nconst x = 1;\n```";
    render(text);
    expect(container.querySelector("h1")?.textContent).toBe("标题");
    expect(container.querySelectorAll("td")).toHaveLength(2);
    expect(container.querySelector<HTMLInputElement>("input")?.disabled).toBe(true);
    expect(container.querySelector("del")?.textContent).toBe("删除");
    click(container.querySelectorAll("button")[1]!);
    expect(container.querySelector("pre")?.textContent).toBe(text);
    expect(container.querySelector("table")).toBeNull();
    click(container.querySelector("button")!);
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("does not execute HTML, unsafe links or request images before an explicit click", () => {
    render(
      '<script>alert(1)</script>\n\n<img src="/private" onerror="alert(1)">\n\n[x](javascript:alert) [local](../secret) [web](https://example.org)\n\n![relative](./image.png) ![external](https://example.org/image.png)',
    );
    expect(container.querySelector("script,iframe,img")).toBeNull();
    expect([...container.querySelectorAll("a")].map((a) => a.href)).toEqual([
      "https://example.org/",
    ]);
    expect(container.querySelector("a")?.rel).toBe("noopener noreferrer");
    const load = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("加载外部图片"),
    )!;
    click(load);
    expect(container.querySelector("img")?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(container.querySelector("img")?.src).toBe("https://example.org/image.png");
    render("![different](https://example.org/other.png)");
    expect(container.querySelector("img")).toBeNull();
  });

  it("scopes duplicate headings and footnote navigation to the current viewer", () => {
    render(
      "# 你好\n\n# 你好\n\n[跳转](#你好-1) 脚注[^1]\n\n# fn-1\n\n# Footnote label\n\n[^1]: 注释",
    );
    const headings = container.querySelectorAll("h1");
    expect(headings[0]!.id).not.toBe(headings[1]!.id);
    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(headings[1]!.id).toMatch(/你好-1$/);
    const scroll = vi.fn();
    Object.defineProperty(headings[1], "scrollIntoView", { value: scroll });
    click([...container.querySelectorAll("a")].find((a) => a.textContent === "跳转")!);
    expect(scroll).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(headings[1]);
    for (const anchor of container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      expect(
        document.getElementById(decodeURIComponent(anchor.getAttribute("href")!.slice(1))),
      ).not.toBeNull();
    }
  });

  it("renders the entire large document, including references defined at its end", () => {
    const text = "[reference][end]\n\n" + "中文 ".repeat(50000) + "\n\n## 文件末尾\n\n[end]: https://example.org";
    render(text);
    expect(container.querySelector("h2")?.textContent).toBe("文件末尾");
    expect(container.querySelector("a")?.href).toBe("https://example.org/");
    expect(container.querySelector("button")?.disabled).toBe(false);
    click(container.querySelectorAll("button")[1]!);
    expect(container.querySelector("pre")?.textContent).toBe(text);
  });

  it("handles empty files", () => {
    render("");
    expect(container.textContent).toContain("文件为空");
  });
});
