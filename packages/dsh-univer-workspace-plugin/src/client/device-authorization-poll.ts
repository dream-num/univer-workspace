export interface DeviceAuthorizationPollOptions {
  readonly deviceCode: string;
  readonly intervalMs: number;
  readonly expiresAt: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (delayMs: number) => Promise<void>;
}

export async function pollDeviceAuthorization(
  options: DeviceAuthorizationPollOptions,
): Promise<Record<string, unknown>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  let delayMs = Math.max(1000, options.intervalMs);

  while (now() < options.expiresAt) {
    const response = await fetchImpl("/auth/device/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode: options.deviceCode }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (response.status === 202) {
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 1.25, 5000);
      continue;
    }
    if (!response.ok) {
      throw new Error(typeof body.error === "string" ? body.error : "workspace_login_failed");
    }
    return body;
  }

  throw new Error("workspace_authorization_expired");
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}
