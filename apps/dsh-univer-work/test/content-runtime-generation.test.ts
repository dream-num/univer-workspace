import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Context } from "@deepseek-ai/cordis";
import {
  credentialKey,
  CredentialProvider,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from "@deepseek-ai/dsh-credentials";
import {
  WorkspaceApplicationError,
  type WorkspaceContentRuntime,
  type WorkspaceContentRuntimeOptions,
  type WorkspaceRuntimeTarget,
} from "@univerjs/univer-workspace-client-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceContentRuntimeGenerations,
} from "../src/content-runtime-generation.js";
import {
  grantRecord,
  WORKSPACE_CREDENTIAL_KEY,
  WorkspaceAuthenticationRequiredError,
} from "../src/authentication-state.js";

const origin = "https://workspace.test";
const target: WorkspaceRuntimeTarget = {
  origin,
  revision: 1,
  scope: { kind: "worktree", worktreeId: "worktree-1" },
  unitId: "unit-1",
  unitType: "sheet",
};
const contexts: Context[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => await ctx.fiber.dispose()));
});

describe("Workspace content runtime generations", () => {
  it("creates lazily, reuses one generation, and resolves current credential and license", async () => {
    const { credentials } = await credentialContext();
    credentials.seed(authenticated("cookie-1"));
    const created: WorkspaceContentRuntimeOptions[] = [];
    const runtimes: FakeRuntime[] = [];
    const generations = new WorkspaceContentRuntimeGenerations(credentials, {
      createRuntime: (options) => {
        created.push(options);
        const runtime = new FakeRuntime();
        runtimes.push(runtime);
        return runtime;
      },
      env: { UNIVER_LICENSE: " override-license " },
    });

    expect(created).toHaveLength(0);
    const first = await generations.run(new AbortController().signal, async () => ({
      cookie: await created[0]!.resolveCredential(target),
      license: await created[0]!.resolveLicense(),
    }));
    await generations.run(new AbortController().signal, async (runtime) => {
      expect(runtime).toBe(runtimes[0]);
    });

    expect(first).toEqual({ cookie: "workspace_session=cookie-1", license: " override-license " });
    expect(created).toHaveLength(1);
    expect(String(created[0]!.workerEntry)).toMatch(/\/worker\.js$/u);
    await generations.close();
    expect(runtimes[0]!.close).toHaveBeenCalledTimes(1);
  });

  it("retires on only the owned Cordis credential event and drains active work before replacement", async () => {
    const { ctx, credentials } = await credentialContext();
    credentials.seed(authenticated("cookie-old"));
    const created: WorkspaceContentRuntimeOptions[] = [];
    const runtimes: FakeRuntime[] = [];
    const generations = new WorkspaceContentRuntimeGenerations(credentials, {
      createRuntime: (options) => {
        created.push(options);
        const runtime = new FakeRuntime();
        runtimes.push(runtime);
        return runtime;
      },
      env: {},
    });
    const unregister = generations.listen(ctx);
    const bodyGate = deferred<void>();
    let bodyEntered = false;
    const active = generations.run(new AbortController().signal, async () => {
      expect(await created[0]!.resolveCredential(target)).toBe("workspace_session=cookie-old");
      bodyEntered = true;
      await bodyGate.promise;
    });
    await vi.waitFor(() => expect(bodyEntered).toBe(true));

    credentials.emit(credentialKey("other", "workspace"));
    await Promise.resolve();
    expect(runtimes[0]!.close).not.toHaveBeenCalled();

    credentials.seed(authenticated("cookie-new"));
    credentials.emit(WORKSPACE_CREDENTIAL_KEY);
    const replacement = generations.run(new AbortController().signal, async () =>
      await created[1]!.resolveCredential(target));
    await Promise.resolve();
    expect(runtimes[0]!.close).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);

    bodyGate.resolve();
    await active;
    await expect(replacement).resolves.toBe("workspace_session=cookie-new");
    expect(runtimes).toHaveLength(2);
    expect(runtimes[0]!.close).toHaveBeenCalledTimes(1);

    credentials.seed(undefined);
    credentials.emit(WORKSPACE_CREDENTIAL_KEY);
    await expect(generations.run(new AbortController().signal, async () =>
      await created[2]!.resolveCredential(target))).rejects.toBeInstanceOf(
      WorkspaceAuthenticationRequiredError,
    );
    expect(runtimes[1]!.close).toHaveBeenCalledTimes(1);
    unregister();
    await generations.close();
    expect(runtimes[2]!.close).toHaveBeenCalledTimes(1);
  });

  it("checks origin, signal, license availability, and closes each generation once", async () => {
    const { credentials } = await credentialContext();
    credentials.seed(authenticated("credential-sentinel"));
    let options!: WorkspaceContentRuntimeOptions;
    const runtime = new FakeRuntime();
    const generations = new WorkspaceContentRuntimeGenerations(credentials, {
      createRuntime: (value) => {
        options = value;
        return runtime;
      },
      defaultLicense: "   ",
      env: {},
    });

    await generations.run(new AbortController().signal, async () => undefined);
    await expect(options.resolveCredential({ ...target, origin: "https://other.test" }))
      .rejects.toMatchObject({ code: "workspace-origin-mismatch" });
    expect(() => options.resolveLicense()).toThrow(expect.objectContaining({
      code: "workspace-license-required",
    }));
    const controller = new AbortController();
    controller.abort(new Error("caller cancelled"));
    await expect(options.resolveCredential(target, controller.signal)).rejects.toThrow(
      "caller cancelled",
    );

    await generations.retire();
    await generations.retire();
    await generations.close();
    expect(runtime.close).toHaveBeenCalledTimes(1);
    await expect(generations.run(new AbortController().signal, async () => undefined))
      .rejects.toBeInstanceOf(WorkspaceApplicationError);
  });

  it("keeps the Browser, CLI, and DSH application license copies synchronized", async () => {
    const paths = [
      new URL("../../workspace/web/src/features/editor/license.ts", import.meta.url),
      new URL("../../cli/src/license.ts", import.meta.url),
      new URL("../src/license.ts", import.meta.url),
    ];
    const hashes = await Promise.all(paths.map(async (path) => {
      const source = await readFile(path, "utf8");
      const value = source.match(/export const UNIVER_LICENSE\s*=\s*\n?\s*"([^"]+)"/u)?.[1];
      if (value === undefined) throw new Error(`Missing application license in ${path.pathname}`);
      return createHash("sha256").update(value).digest("hex");
    }));
    expect(new Set(hashes).size).toBe(1);
  });
});

class FakeRuntime implements WorkspaceContentRuntime {
  public readonly close = vi.fn(async () => undefined);
  public readonly executeAndCommit = vi.fn<WorkspaceContentRuntime["executeAndCommit"]>();
  public readonly executeRead = vi.fn<WorkspaceContentRuntime["executeRead"]>();
  public readonly exportUnitData = vi.fn<WorkspaceContentRuntime["exportUnitData"]>();
}

class MemoryCredentials extends CredentialProvider {
  private record: CredentialRecord | undefined;

  public seed(record: CredentialRecord | undefined): void {
    this.record = record;
  }

  public emit(key: CredentialKey): void {
    this.notifyRecordUpdated(key);
  }

  public override readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(this.record);
  }

  public override async modifyRecord(
    _key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const replacement = await mutate(this.record);
    if (replacement !== undefined) this.record = replacement;
    this.notifyRecordUpdated(WORKSPACE_CREDENTIAL_KEY);
    return this.record;
  }

  public override deleteRecord(_key: CredentialKey): Promise<void> {
    this.record = undefined;
    this.notifyRecordUpdated(WORKSPACE_CREDENTIAL_KEY);
    return Promise.resolve();
  }

  public override resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> { return Promise.resolve(undefined); }
  public override describe(_ref: CredentialRef): Promise<CredentialInfo> { return Promise.resolve({ configured: false, writable: true }); }
  public override set(_ref: CredentialRef, _value: string): Promise<void> { return Promise.resolve(); }
  public override unset(_ref: CredentialRef): Promise<void> { return Promise.resolve(); }
  public override describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return Promise.resolve(this.record === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: this.record.kind, writable: true });
  }
  public override listRecords(): Promise<readonly CredentialRecordEntry[]> { return Promise.resolve([]); }
}

async function credentialContext(): Promise<{
  readonly credentials: MemoryCredentials;
  readonly ctx: Context;
}> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(MemoryCredentials);
  const credentials = ctx.credentials as MemoryCredentials;
  return { credentials, ctx };
}

function authenticated(cookie: string): CredentialRecord {
  return grantRecord({
    state: "authenticated",
    cookie: `workspace_session=${cookie}`,
    origin,
    subject: { id: "user-1", name: "Alice" },
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
