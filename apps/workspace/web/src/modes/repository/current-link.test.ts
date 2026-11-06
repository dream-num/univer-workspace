import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CurrentAnchor } from "./current-link";
import { resolveFrame } from "./shell/frame";

const tabs = ["files", "issues", "prs", "apps", "settings"] as const;

describe("Repository tab selection", () => {
  it.each(tabs)("keeps only %s current when the router also matches Code", (tab) => {
    const frame = resolveFrame({ selectedSpaceId: "s", repositoryTab: tab });
    if (frame.kind !== "repository") throw new Error("Expected repository frame");
    const html = tabs.map((item) => renderToStaticMarkup(createElement(CurrentAnchor, {
      href: `/spaces/s${item === "files" ? "" : `/${item}`}`,
      // TanStack supplies this for matching parent paths before calling the anchor.
      "aria-current": item === "files" || item === tab ? "page" : undefined,
      current: frame.tab === item,
      children: item,
    }))).join("");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain(`aria-current="page">${tab}</a>`);
  });
});
