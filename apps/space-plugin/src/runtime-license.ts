import { readFileSync } from 'node:fs';

/** Host-only fallback for explicitly packaged internal Desktop test builds. */
export function readRuntimeLicense(
  environment = process.env.UNIVER_LICENSE,
  file = new URL('./runtime-license.json', import.meta.url),
): string {
  if (environment?.trim()) return environment;
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw new Error('Cannot read packaged runtime license configuration.');
  }
  try {
    const config = JSON.parse(text);
    if (config.scope === 'internal-desktop-test' && typeof config.license === 'string' && config.license.trim())
      return config.license;
  } catch { /* Never include credential text in diagnostics. */ }
  throw new Error('Invalid packaged runtime license configuration.');
}
