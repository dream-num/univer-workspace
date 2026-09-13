/** Desktop build output, using DSH's exported graph and response API. */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ClientModuleRegistry, WebBootGraph } from "@deepseek-ai/dsh-client-modules";

export interface DesktopClientArtifact {
  format: 1;
  graph: WebBootGraph;
  files: Record<string, string>;
}

export async function exportDesktopClient(
  registry: Pick<ClientModuleRegistry, "graph" | "fetchBundle">,
  directory: string,
): Promise<void> {
  const graph = structuredClone(registry.graph());
  const files: Record<string, string> = {};
  const transformed = new Map<string, { url: string; rev: string }>();
  await mkdir(directory, { recursive: true });
  for (const row of graph.batches) {
    let artifact = transformed.get(row.url);
    if (!artifact) {
      const response = registry.fetchBundle(
        new Request(new URL(row.url, "http://desktop.invalid")),
      );
      if (!response.ok) throw new Error(`DSH client artifact returned ${response.status}`);
      // Production ships executable output only. Strip the SDK-generated map
      // trailer; never request, store or serve its source-map response.
      const script = (await response.text()).replace(
        /(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/,
        "\n",
      );
      const rev = createHash("sha256").update(script).digest("hex");
      const file = `${rev}.js`;
      const url = `/plugins/workspace-desktop/${file}`;
      await writeFile(join(directory, file), script);
      files[url] = file;
      artifact = { url, rev };
      transformed.set(row.url, artifact);
    }
    Object.assign(row, artifact);
  }
  // HMR is disabled for this fixed roster. Reuse the SDK's batch response
  // for each member instead of shipping a second copy of every client script.
  for (const entry of graph.entries) {
    const owners = graph.batches.filter((batch) => batch.entries.includes(entry.id));
    if (owners.length !== 1) throw new Error(`Invalid DSH batch ownership for ${entry.id}`);
    Object.assign(entry, { url: owners[0]!.url, rev: owners[0]!.rev });
  }
  graph.rev = createHash("sha256")
    .update(JSON.stringify({ entries: graph.entries, batches: graph.batches }))
    .digest("hex");
  const artifact: DesktopClientArtifact = { format: 1, graph, files };
  await writeFile(join(directory, "manifest.json"), JSON.stringify(artifact));
}
