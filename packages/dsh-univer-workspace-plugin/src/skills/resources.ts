import { BundledSkillResources as SharedResources, SkillResourceError } from "@univerjs/univer-workspace-agent-runtime/workspace-skill-resources";
import { UniverError } from "../tools/errors.ts";
export class BundledSkillResources extends SharedResources {
  private async originalError<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) { if (error instanceof SkillResourceError) throw new UniverError(error.message, error.code, { cause: error }); throw error; }
  }
  override entry(skill: string, signal?: AbortSignal) { return this.originalError(() => super.entry(skill, signal)); }
  override list(skill: string, signal?: AbortSignal) { return this.originalError(() => super.list(skill, signal)); }
  override read(skill: string, path: string, signal?: AbortSignal) { return this.originalError(() => super.read(skill, path, signal)); }
}
