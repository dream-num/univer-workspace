import { describe, expect, it, vi } from "vitest";
import { pollDeviceAuthorization } from "../src/client/device-authorization-poll.ts";

describe("pollDeviceAuthorization", () => {
  it("polls pending authorization until Workspace returns an identity", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "pending" }), { status: 202 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "restart_required", identity: { userId: "u-1" } }), {
          status: 200,
        }),
      );
    const sleep = vi.fn(async () => undefined);
    const result = await pollDeviceAuthorization({
      deviceCode: "device-1",
      intervalMs: 5000,
      expiresAt: 10_000,
      fetchImpl,
      now: () => 1_000,
      sleep,
    });

    expect(result).toMatchObject({ status: "restart_required" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("stops before making a request after the authorization expires", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      pollDeviceAuthorization({
        deviceCode: "expired",
        intervalMs: 1000,
        expiresAt: 1_000,
        fetchImpl,
        now: () => 1_000,
        sleep: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow("workspace_authorization_expired");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces a non-pending Workspace error", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "device_authorization_not_found" }), { status: 400 }),
      );
    await expect(
      pollDeviceAuthorization({
        deviceCode: "missing",
        intervalMs: 1000,
        expiresAt: 10_000,
        fetchImpl,
        now: () => 1_000,
        sleep: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow("device_authorization_not_found");
  });
});
