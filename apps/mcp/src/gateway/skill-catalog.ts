import { SkillsExtension } from "@modelcontextprotocol/server/ext/skills";
import { nodeSkillFiles } from "@modelcontextprotocol/server/ext/skills/node";

// Snapshot static content once so the extension and fallback keep serving the published digests.
export async function loadWorkspaceSkills(root: string) {
  const source = nodeSkillFiles(root);
  const files = new Map<string, Uint8Array>();
  const catalog = await SkillsExtension.load(
    {
      list: (path) => source.list(path),
      async read(path) {
        let bytes = files.get(path);
        if (bytes === undefined) {
          bytes = await source.read(path);
          files.set(path, bytes);
        }
        return bytes;
      },
    },
    { prefix: "univer-workspace", strict: true },
  );
  return {
    catalog,
    read(name: string, path: string) {
      const bytes = files.get(`${name}/${path}`);
      if (bytes === undefined) throw new Error("Skill file is absent from the catalog snapshot");
      return new TextDecoder().decode(bytes);
    },
  };
}

export type WorkspaceSkills = Awaited<ReturnType<typeof loadWorkspaceSkills>>;
