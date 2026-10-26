import { existsSync } from 'node:fs';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Keep generated acceptance evidence outside the implementation repository. */
export async function writeEvidence(name, value) {
  const directory = resolve(process.env.SPACE_EVIDENCE_DIR ?? join(tmpdir(), 'space-plugin-evidence'));
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const inside = (path, base) => path === base || path.startsWith(base + sep);
  const repository = existsSync(join(root, '.git')) ? await realpath(root) : null;
  if (repository && inside(directory, repository)) throw new Error('SPACE_EVIDENCE_DIR must be outside the code repository.');
  await mkdir(directory, { recursive: true });
  if (repository && inside(await realpath(directory), repository)) throw new Error('SPACE_EVIDENCE_DIR resolves inside the code repository.');
  await writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n');
}
