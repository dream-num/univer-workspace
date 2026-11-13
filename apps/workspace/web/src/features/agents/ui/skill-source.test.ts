import { expect, it } from "vitest";
import { skillProvenance } from "./skill-source";

it.each(["github", "skills-sh", "clawhub", "space"])("shows the %s import origin", (hub) => {
  expect(skillProvenance({ "source-hub": hub, source: "github.com/anthropics/skills/skills/pdf" }))
    .toEqual({ hub, href: hub === "space" ? undefined : "https://github.com/anthropics/skills/skills/pdf" });
});
it("keeps plain Skills unchanged and untrusted source URLs inert", () => {
  expect(skillProvenance(undefined)).toBeNull();
  expect(skillProvenance({ source: "https://github.com/owner/repo" })).toBeNull();
  for (const source of ["javascript:alert(1)", "https://evil.example/pdf", "https://github.com.evil.example/pdf", "https://user@github.com/pdf", "https://github.com:444/pdf"]) {
    expect(skillProvenance({ "source-hub": "github", source })).toEqual({ hub: "github", href: undefined });
  }
});

it("links GitHub hub coordinates to the pinned imported folder", () => {
  const commit = "2c5958ecac7cee2b583967a2c4981d0f4a75c579";
  expect(skillProvenance({ "source-hub": "github", source: "github.com/anthropics/skills/skills/pdf", "source-commit": commit })?.href)
    .toBe(`https://github.com/anthropics/skills/tree/${commit}/skills/pdf`);
  const page = `https://github.com/anthropics/skills/tree/${commit}/skills/pdf`;
  expect(skillProvenance({ "source-hub": "skills-sh", source: page, "source-commit": commit })?.href).toBe(page);
});
