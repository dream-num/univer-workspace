// Supplied at runtime by the owner-only Host route. No development credential
// or build-time secret is embedded in a distributable plugin.
export let workspaceLicense = '';
export function configureLicense(value: string) {
  workspaceLicense = value;
}
