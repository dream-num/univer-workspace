import type { SkillCatalog } from "../agent.types";
import { useAgentMessages } from "./messages";

export function skillProvenance(metadata: SkillCatalog["skills"][number]["metadata"]) {
  const hub = metadata?.["source-hub"];
  if (hub !== "github" && hub !== "skills-sh" && hub !== "clawhub" && hub !== "space") return null;
  const source = metadata?.source;
  let href: string | undefined;
  if (hub !== "space" && source) {
    try {
      const url = new URL(source.startsWith("https://") ? source : `https://${source}`);
      const commit = metadata?.["source-commit"];
      if (url.hostname === "github.com" && commit && /^[a-f0-9]{40}$/.test(commit)) {
        const [, owner, repo, ...path] = url.pathname.split("/");
        if (owner && repo && path[0] !== "tree" && path[0] !== "blob")
          url.pathname = `/${owner}/${repo}/tree/${commit}${path.length ? `/${path.join("/")}` : ""}`;
      }
      if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
        ["github.com", "skills.sh", "clawhub.ai"].includes(url.hostname)) href = url.href;
    } catch { /* A malformed source remains a label. */ }
  }
  return { hub, href } as const;
}

export function SkillSource({ metadata }: { readonly metadata: SkillCatalog["skills"][number]["metadata"] }) {
  const m = useAgentMessages();
  const source = skillProvenance(metadata);
  if (!source) return null;
  const label = m.skillFrom[source.hub];
  return source.href ? <a className="agent-skill-source" href={source.href} target="_blank" rel="noreferrer">{label}</a>
    : <span className="agent-skill-source">{label}</span>;
}
