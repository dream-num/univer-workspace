import type { ExchangeFormat } from "@univerjs-pro/exchange-client";
import { Disposable, toDisposable } from "@univerjs/core";
import { MessageType } from "@univerjs/design";
import { ErrorCode, type IError } from "@univerjs/protocol";
import { BehaviorSubject, type Observable } from "rxjs";
import type {
  WorkspaceExchangeDefinition,
  WorkspaceExchangeUnitType,
  WorkspaceUnitExchange,
} from "./definitions";
import { importExportKey, type ImportExportLocaleKey } from "./locale";

export enum UploadNotificationState {
  UPLOADING,
  SUCCESS,
  ERROR,
}

export interface ImportedUnitLink {
  readonly name: string;
  readonly type: WorkspaceExchangeUnitType;
  /** Workspace page of the imported Unit; absent when it cannot be resolved. */
  readonly link?: string;
}

export interface UploadProgress {
  readonly done: number;
  readonly count: number;
}

export interface ImportExportServiceDependencies {
  readonly definition: WorkspaceExchangeDefinition;
  readonly exchange: WorkspaceUnitExchange;
  /** One event per exchange HTTP request, from the SDK IExchangeService. */
  readonly requestState$: Observable<{ readonly error?: IError | undefined }>;
  downloadFile(file: File, name: string, format: ExchangeFormat): void;
  interruptImportTask(): void;
  showMessage(message: { readonly type: MessageType; readonly content: string }): void;
  translate(key: string, ...args: string[]): string;
  pickFile(accept: string): Promise<File | undefined>;
  resolveUnitLink(unitId: string): Promise<string | undefined>;
  resolveUnitName(unitId: string): Promise<string | undefined>;
}

/**
 * The Workspace replacement for the import/export UI state that SDK 1.1
 * exchange clients owned: file selection, upload progress, the imported-file
 * notification and downloads. Conversion itself stays in the Workspace server.
 */
export class WorkspaceImportExportService extends Disposable {
  private readonly progressSubject = new BehaviorSubject<UploadProgress>({ done: 0, count: 0 });
  private readonly visibleSubject = new BehaviorSubject(false);
  private readonly stateSubject = new BehaviorSubject(UploadNotificationState.UPLOADING);
  private readonly linksSubject = new BehaviorSubject<readonly ImportedUnitLink[]>([]);

  readonly progress$ = this.progressSubject.asObservable();
  readonly visible$ = this.visibleSubject.asObservable();
  readonly state$ = this.stateSubject.asObservable();
  readonly links$ = this.linksSubject.asObservable();

  private selectingFile = false;
  private canRetryImport = false;

  constructor(private readonly dependencies: ImportExportServiceDependencies) {
    super();
    const subscription = dependencies.requestState$.subscribe(({ error }) => {
      if (error?.code === ErrorCode.OK) this.addDone(1);
      else this.showMessage(MessageType.Error, networkErrorKey(error));
    });
    this.disposeWithMe(toDisposable(() => subscription.unsubscribe()));
  }

  override dispose(): void {
    super.dispose();
    this.progressSubject.complete();
    this.visibleSubject.complete();
    this.stateSubject.complete();
    this.linksSubject.complete();
  }

  /** Import an Office file as a new Unit in the user's Personal Space. */
  async importFile(): Promise<string | undefined> {
    if (this.selectingFile || this.uploadInProgress()) {
      this.showMessage(MessageType.Warning, "uploading");
      return undefined;
    }
    const { definition } = this.dependencies;
    let file: File | undefined;
    this.selectingFile = true;
    try {
      file = await this.dependencies.pickFile(
        definition.importExtensions.map((extension) => `.${extension}`).join(",")
      );
    } finally {
      this.selectingFile = false;
    }
    if (!file) return undefined;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !definition.importExtensions.includes(extension)) {
      this.showMessage(MessageType.Error, "fileTypeError", file.name);
      return undefined;
    }
    this.canRetryImport = true;

    this.visibleSubject.next(true);
    this.stateSubject.next(UploadNotificationState.UPLOADING);
    // Upload, import task, task polling and the result: show progress before
    // the first request settles.
    this.addTotal(4);
    this.addDone(1);
    let unitId: string | undefined;
    try {
      unitId = await this.dependencies.exchange.importToUnit(file);
    } catch {
      unitId = undefined;
    }
    if (!unitId) {
      this.clearProgress();
      this.stateSubject.next(UploadNotificationState.ERROR);
      return undefined;
    }
    const link = await this.dependencies.resolveUnitLink(unitId).catch(() => undefined);
    this.linksSubject.next([
      { name: file.name, type: definition.unitType, ...(link ? { link } : {}) },
      ...this.linksSubject.value,
    ]);
    this.completeProgress();
    this.stateSubject.next(UploadNotificationState.SUCCESS);
    return unitId;
  }

  async retryImport(): Promise<string | undefined> {
    return this.canRetryImport ? this.importFile() : undefined;
  }

  interrupt(): void {
    this.clearProgress();
    this.stateSubject.next(UploadNotificationState.ERROR);
    this.dependencies.interruptImportTask();
  }

  hideNotification(): void {
    this.visibleSubject.next(false);
  }

  /**
   * Export the current Unit through the server; `targetId` picks a sheet or
   * table. The download takes the Workspace Node name, as the server's own
   * filename does, so `file.name` (the Content-Disposition name the SDK parses)
   * is not used.
   */
  async exportUnit(format: ExchangeFormat, targetId?: string): Promise<boolean> {
    const unit = this.dependencies.exchange.currentUnit();
    if (!unit) return false;
    this.showMessage(MessageType.Info, "downloading");
    const [file, nodeName] = await Promise.all([
      this.dependencies.exchange.exportByUnitId(unit.unitId, format, targetId),
      this.dependencies.resolveUnitName(unit.unitId).catch(() => undefined),
    ]);
    if (!file) return false;
    this.dependencies.downloadFile(file, nodeName || unit.name || unit.unitId, format);
    this.showMessage(MessageType.Success, "downloadSuccess");
    return true;
  }

  private showMessage(type: MessageType, key: ImportExportLocaleKey, ...args: string[]): void {
    this.dependencies.showMessage({
      type,
      content: this.dependencies.translate(importExportKey(key), ...args),
    });
  }

  private uploadInProgress(): boolean {
    const { done, count } = this.progressSubject.value;
    return count !== 0 && done !== count;
  }

  private addTotal(count: number): void {
    const progress = this.progressSubject.value;
    this.progressSubject.next({ ...progress, count: progress.count + count });
  }

  private addDone(count: number): void {
    const progress = this.progressSubject.value;
    this.progressSubject.next({
      ...progress,
      done: Math.min(progress.done + count, progress.count),
    });
  }

  private completeProgress(): void {
    const { count } = this.progressSubject.value;
    this.progressSubject.next({ done: count, count });
  }

  private clearProgress(): void {
    this.progressSubject.next({ done: 0, count: 0 });
  }
}

export function networkErrorKey(error: IError | undefined): ImportExportLocaleKey {
  switch (error?.code) {
    case ErrorCode.LICENSE_EXPORT_SIZE_EXCEEDED:
    case ErrorCode.CONNECTOR_DATA_TOO_LARGE:
      return "tooLarge";
    case ErrorCode.LICENSE_EXPORT_QUOTA_EXCEEDED:
      return "exportQuotaExceeded";
    case ErrorCode.LICENSE_INVALID:
    case ErrorCode.LICENSE_POLICY_INVALID:
      return "licensePolicyInvalid";
    case ErrorCode.LICENSE_VERSION_NOT_ALLOWED:
      return "licenseVersionNotAllowed";
    case ErrorCode.LICENSE_UNIT_TYPE_REJECTED:
      return "licenseUnitTypeRejected";
    case ErrorCode.LICENSE_NOT_YET_EFFECTIVE:
      return "licenseNotYetEffective";
    case ErrorCode.LICENSE_USAGE_STATE_INVALID:
    case ErrorCode.LICENSE_USAGE_STORAGE_ERROR:
      return "exportQuotaCheckFailed";
    case ErrorCode.LICENSE_CONCURRENCY_TIMEOUT:
      return "licenseConcurrencyTimeout";
    case ErrorCode.INTERNAL_ERROR:
      return "internalError";
    default:
      return "networkError";
  }
}
