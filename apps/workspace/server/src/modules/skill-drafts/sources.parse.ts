import { ApplicationError } from "../../middleware/errors.js";
import { safeSkillPath } from "./scan.js";
import type { SourceInput } from "./sources.types.js";

export const invalidSource = (
  message = "Unsupported Skill source. Use GitHub, skills.sh, ClawHub or a Space node ID.",
) => new ApplicationError("INVALID_INPUT", 400, message);
const coordinate = (value: string | undefined): value is string =>
  !!value && /^[A-Za-z0-9_.-]+$/.test(value) && value !== "." && value !== "..";

export function parseSkillSource(value: string): SourceInput {
  let input = value.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input))
    return { kind: "space", nodeId: input };
  let selected: string | undefined;
  let version: string | undefined;
  let commandHub: "skills-sh" | "clawhub" | undefined;
  if (/^(?:npx\s|clawhub\s)/.test(input)) {
    const tokens =
      input
        .match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+/g)
        ?.map((s) => s.replace(/^(['"])(.*)\1$/, "$2")) ?? [];
    if (tokens[0] === "npx") {
      tokens.shift();
      if (["-y", "--yes"].includes(tokens.at(0) ?? "")) tokens.shift();
      if (
        !/^skills(?:@(?:latest|[0-9.]+))?$/.test(tokens.shift() ?? "") ||
        tokens.shift() !== "add"
      )
        throw invalidSource();
      commandHub = "skills-sh";
    } else {
      tokens.shift();
      if (tokens.shift() !== "install") throw invalidSource();
      commandHub = "clawhub";
    }
    const sources: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (["-g", "--global", "-y", "--yes"].includes(token)) continue;
      if (token === "--skill" || token === "--version" || token === "--owner") {
        const next = tokens[++i];
        if (
          !coordinate(next) &&
          !(token === "--version" && next && /^[A-Za-z0-9_.+-]+$/.test(next))
        )
          throw invalidSource();
        if (token === "--skill") selected = next;
        if (token === "--version") version = next;
        if (token === "--owner") sources.push(`@owner=${next}`);
      } else if (token.startsWith("-") || /[;&|`$<>\r\n]/.test(token)) throw invalidSource();
      else sources.push(token);
    }
    const ownerOption = sources.find((s) => s.startsWith("@owner="))?.slice(7);
    const args = sources.filter((s) => !s.startsWith("@owner="));
    if (args.length !== 1) throw invalidSource();
    input = args[0]!;
    if (commandHub === "clawhub" && !input.includes("://")) {
      const parts = input.replace(/^@/, "").split("/");
      const owner = parts.length === 2 ? parts[0] : ownerOption;
      const slug = parts.at(-1);
      if (!coordinate(owner) || !coordinate(slug))
        throw invalidSource(
          "ClawHub needs an owner handle. Use clawhub install owner/slug or --owner owner.",
        );
      return { kind: "clawhub", owner, slug, ...(version ? { version } : {}) };
    }
  }
  if (!input.includes("://") && /^(?:github\.com|skills\.sh|clawhub\.ai)\//.test(input))
    input = `https://${input}`;
  if (!input.includes("://")) {
    const match = /^([^/]+)\/([^/@]+)(?:@([^/]+)|\/([^/]+))?$/.exec(input);
    if (
      !match ||
      !coordinate(match[1]) ||
      !coordinate(match[2]) ||
      ((match[3] || match[4]) && !coordinate(match[3] ?? match[4]))
    )
      throw invalidSource();
    return {
      kind: "git",
      hub: "skills-sh",
      owner: match[1],
      repo: match[2],
      ref: "HEAD",
      path: "",
      ...(selected || match[3] || match[4] ? { skill: selected ?? match[3] ?? match[4] } : {}),
    };
  }
  try {
    if (
      decodeURIComponent(input).includes("\\") ||
      /\/(?:\.|\.\.)(?:\/|$)/.test(decodeURIComponent(input))
    )
      throw invalidSource();
  } catch {
    throw invalidSource();
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw invalidSource();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    throw invalidSource();
  let parts: string[];
  try {
    parts = url.pathname.replace(/\/$/, "").slice(1).split("/").map(decodeURIComponent);
  } catch {
    throw invalidSource();
  }
  const [owner, repo] = parts;
  if (!coordinate(owner) || !coordinate(repo)) throw invalidSource();
  if (url.hostname === "clawhub.ai") {
    const slug =
      parts.length === 3 && repo === "skills" ? parts[2] : parts.length === 2 ? repo : undefined;
    if (!coordinate(slug)) throw invalidSource();
    return { kind: "clawhub", owner, slug, ...(version ? { version } : {}) };
  }
  if (url.hostname === "skills.sh") {
    if (parts.length !== 3 || !coordinate(parts[2])) throw invalidSource();
    return {
      kind: "git",
      hub: "skills-sh",
      owner,
      repo,
      ref: "HEAD",
      path: "",
      skill: selected ?? parts[2],
    };
  }
  if (url.hostname !== "github.com") throw invalidSource();
  const repository = repo.replace(/\.git$/, "");
  if (!coordinate(repository)) throw invalidSource();
  if (parts.length === 2)
    return {
      kind: "git",
      hub: commandHub === "skills-sh" ? "skills-sh" : "github",
      owner,
      repo: repository,
      ref: "HEAD",
      path: "",
      ...(selected ? { skill: selected } : {}),
    };
  if (!["tree", "blob"].includes(parts[2]!) || !parts[3] || !safeSkillPath(parts[3]))
    throw invalidSource();
  let path = parts.slice(4).join("/");
  if (path && !safeSkillPath(path)) throw invalidSource();
  if (parts[2] === "blob") {
    if (!path) throw invalidSource();
    path = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  }
  return {
    kind: "git",
    hub: commandHub === "skills-sh" ? "skills-sh" : "github",
    owner,
    repo: repository,
    ref: parts[3],
    path,
    ...(selected ? { skill: selected } : {}),
  };
}
