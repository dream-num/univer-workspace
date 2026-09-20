import { UNIVER_LICENSE } from "./license";

export function resolveUniverLicense(
  configuredLicense = import.meta.env.VITE_UNIVER_LICENSE
): string {
  return configuredLicense?.trim() || UNIVER_LICENSE;
}
