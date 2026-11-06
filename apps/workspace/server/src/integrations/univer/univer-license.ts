import { UNIVER_LICENSE, UNIVER_LICENSE_KEY } from "./license.js";

/**
 * Credentials the server-side Collaboration and Exchange SDKs verify. Without
 * them both SDKs fall back to their free tier, so every server use passes them
 * explicitly instead of relying on the SDKs reading the process environment.
 */
export interface UniverLicenseCredentials {
  readonly license: string;
  readonly licenseKey: string;
}

export const BUNDLED_UNIVER_LICENSE: UniverLicenseCredentials = {
  license: UNIVER_LICENSE,
  licenseKey: UNIVER_LICENSE_KEY,
};

/** Deployment credentials override the bundled development license as a pair. */
export function resolveUniverLicense(
  environment: NodeJS.ProcessEnv
): UniverLicenseCredentials {
  const license = environment.UNIVER_LICENSE?.trim() || undefined;
  const licenseKey = environment.UNIVER_LICENSE_KEY?.trim() || undefined;
  if (license === undefined && licenseKey === undefined) {
    return BUNDLED_UNIVER_LICENSE;
  }
  if (license === undefined || licenseKey === undefined) {
    throw new Error("UNIVER_LICENSE and UNIVER_LICENSE_KEY must be configured together");
  }
  return { license, licenseKey };
}
