import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { SkillCandidate, SkillDefinition, SkillProvider } from '@deepseek-ai/dsh-skill';
import { BundledSkillResources } from '@univerjs/univer-workspace-agent-runtime/workspace-skill-resources';
import { SpaceError } from './workspace.js';

const names = ['univer', 'univer-sheet', 'univer-doc', 'univer-slide', 'univer-base', 'univer-board', 'univer-embed', 'univer-cross-unit-formula', 'univer-html-view'] as const;
const oldTools = ['univer_blob', 'univer_spaces', 'univer_documents', 'univer_list', 'univer_open', 'univer_status', 'univer_new', 'univer_create', 'univer_issue', 'univer_worktree', 'univer_edit', 'univer_inspect', 'univer_execute', 'univer_import', 'univer_export', 'univer_unit', 'univer_api', 'univer_resources', 'univer_html_view', 'univer_lint', 'univer_screenshot', 'univer_compile_svg', 'univer_skill_resource'];
const invocation = { modelInvocable: true, userInvocable: true } as const;
const resourceBase = { kind: 'opaque' as const, description: 'Read listed references and templates with univer_skill_resource using the exact skill name and resource path.' };

/** Original bundled Workspace skills use the existing DSH skill registry and native tool catalog. */
export function registerWorkspaceSkills(ctx: Context) {
  const resources = new BundledSkillResources(new URL('./skills/', import.meta.url), names);
  const disposeResource = ctx.tools.register({
    name: 'univer_skill_resource',
    description: 'Read a reference or template listed by an original bundled Workspace Skill. Pass its exact skill name and relative resource path.',
    parameters: { type: 'object', properties: { skill: { type: 'string' }, path: { type: 'string' } }, required: ['skill', 'path'] },
    output: { schema: {}, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    async execute(args: any, exec: ToolRunContext) {
      if (!args || typeof args.skill !== 'string' || typeof args.path !== 'string') throw new SpaceError(400, 'Provide an exact skill and resource path.');
      return resources.read(args.skill, args.path, exec.signal);
    },
    presentCall: () => ({ card: 'generic', title: 'Read Workspace skill reference', kind: 'read' }),
  });
  const provider: SkillProvider = {
    name: 'univer-workspace-space',
    async list(options) {
      return Promise.all(names.map(async (name): Promise<SkillCandidate> => {
        const entry = await resources.entry(name, options.signal);
        const description = name === 'univer'
          ? 'Create, inspect, edit, import, export and review Univer Workspace documents through the native Space Agent tools.'
          : /^description:\s*(.+)$/m.exec(entry)?.[1] ?? `Use original Univer Workspace ${name} guidance.`;
        return { name, description, invocation, provider: 'univer-workspace-space', source: 'bundled', resourceBase, rank: 600, locator: name };
      }));
    },
    async get(candidate, options): Promise<SkillDefinition> {
      const entry = await resources.entry(candidate.name, options.signal);
      const paths = await resources.list(candidate.name, options.signal);
      const end = entry.startsWith('---\n') ? entry.indexOf('\n---\n', 4) : -1;
      const body = end < 0 ? entry : entry.slice(end + 5);
      const unavailable = typeof ctx.tools.get === 'function' ? oldTools.filter(name => !ctx.tools.get(name)) : [];
      const note = [
        '# Space host product rules',
        'For ordinary Floating Chat requests, create and edit directly on the shared Workspace trunk. Use univer_create/univer_new for new Units, univer_import for local Office files, and univer_edit or univer_execute for Facade changes. Do not require a Worktree or user Apply for ordinary edits.',
        'A Worktree is only for an explicit review request. The existing in-document Review and draft editing are connected for the admitted Docs or Sheets document. The univer_unit tool can create a Worktree-local Unit or change its removal intent, and explicit Worktree IDs can be used to read or edit its Units. Multi-Unit Review is not yet connected in this host; Worktree-local import remains a draft until reviewed and applied.',
        'Use the currently registered tool schemas. If an original instruction below conflicts with these Space host rules or names an unavailable tool, follow these rules and report the limitation rather than claiming it was executed.',
        ...(unavailable.length ? [`Unavailable in this host: ${unavailable.join(', ')}.`] : []),
        'The following original Workspace Skill is retained for its domain and Facade guidance:',
      ].join('\n\n');
      const hints = paths.length ? ['\n\n## Bundled references and templates', ...paths.map(path => `- univer_skill_resource ${JSON.stringify({ skill: candidate.name, path })}`)].join('\n') : '';
      return { name: candidate.name, description: candidate.description, invocation, provider: candidate.provider, source: candidate.source, resourceBase, content: `${note}\n\n${body}${hints}` };
    },
  };
  const disposeProvider = ctx.skills.registerProvider(() => provider);
  return () => { disposeProvider(); disposeResource(); };
}
