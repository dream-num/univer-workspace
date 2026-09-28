import GithubSlugger from "github-slugger";
import type { Root, Element, RootContent } from "hast";

function textContent(node: RootContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textContent).join("");
  return "";
}

export function markdownHeadings({ prefix }: { prefix: string }) {
  return (tree: Root) => {
    const slugger = new GithubSlugger();
    function visit(node: Root | Element) {
      if (node.type === "element" && /^h[1-6]$/.test(node.tagName) && !node.properties.id) {
        node.properties.id = `${prefix}heading-${slugger.slug(textContent(node))}`;
      }
      if (node.type === "element" && node.properties.id === "footnote-label") {
        node.properties.id = `${prefix}footnote-label`;
      }
      if (node.type === "element" && node.properties.ariaDescribedBy) {
        node.properties.ariaDescribedBy = `${prefix}footnote-label`;
      }
      for (const child of node.children) if (child.type === "element") visit(child);
    }
    visit(tree);
  };
}
