import { ExchangeFormat } from "@univerjs-pro/exchange-client";
import { LocaleService } from "@univerjs/core";
import {
  Button,
  DropdownMenu,
  MobileActionRowGroup,
  MobileSelect,
  Radio,
  Select,
  Tooltip,
  type IDropdownMenuProps,
} from "@univerjs/design";
import {
  ClockIcon,
  CloseIcon,
  DirectExportIcon,
  DocsMultiIcon,
  ErrorIcon,
  ExportIcon,
  FolderIcon,
  LoadingMultiIcon,
  PdfMultiIcon,
  MoreDownIcon,
  ShareRangeIcon,
  SheetsMultiIcon,
  SlidesMultiIcon,
  SuccessIcon,
} from "@univerjs/icons";
import { useDependency, useObservable } from "@univerjs/ui";
import { useRef, useState, type ReactNode } from "react";
import type { ExportTargets, WorkspaceExchangeUnitType } from "./definitions";
import {
  UploadNotificationState,
  type WorkspaceImportExportService,
} from "./import-export-service";
import { importExportKey, type ImportExportLocaleKey } from "./locale";

function useTranslate() {
  const localeService = useDependency(LocaleService);
  return (key: ImportExportLocaleKey, ...args: string[]) =>
    localeService.t(importExportKey(key), ...args);
}

const STATE_ICONS: Record<UploadNotificationState, ReactNode> = {
  [UploadNotificationState.SUCCESS]: <SuccessIcon className="text-success" />,
  [UploadNotificationState.UPLOADING]: <ClockIcon className="text-primary" />,
  [UploadNotificationState.ERROR]: <ErrorIcon className="text-destructive" />,
};

const STATE_TITLES: Record<UploadNotificationState, ImportExportLocaleKey> = {
  [UploadNotificationState.SUCCESS]: "uploadSuccess",
  [UploadNotificationState.UPLOADING]: "uploading",
  [UploadNotificationState.ERROR]: "unknownMistake",
};

function UnitIcon({ type }: { readonly type: WorkspaceExchangeUnitType }) {
  if (type === "doc") return <DocsMultiIcon />;
  if (type === "slide") return <SlidesMultiIcon />;
  if (type === "pdf") return <PdfMultiIcon />;
  return <SheetsMultiIcon />;
}

/** Imported-file notification; the mobile layout spans the screen width. */
export function UploadNotification({
  service,
  mobile,
}: {
  readonly service: WorkspaceImportExportService;
  readonly mobile: boolean;
}) {
  const t = useTranslate();
  const visible = useObservable(service.visible$, false);
  const state = useObservable(service.state$, UploadNotificationState.UPLOADING);
  const links = useObservable(service.links$, []);
  const progress = useObservable(service.progress$, { done: 0, count: 0 });
  if (!visible) return null;
  const percent = progress.count > 0 ? Math.floor((progress.done / progress.count) * 100) : 0;
  const retry = (
    <Button size="small" variant="text" className="text-primary" onClick={() => void service.retryImport()}>
      {t("uploadAgain")}
    </Button>
  );

  return (
    <section
      data-u-comp="workspace-upload-notification"
      className={
        mobile
          ? "fixed inset-x-3 bottom-16 z-[1000] grid max-h-[50vh] gap-3 overflow-y-auto rounded-xl bg-background p-4 text-foreground shadow-lg"
          : "fixed right-3 bottom-12 z-[1000] flex w-[372px] flex-col gap-3 rounded-md bg-background px-3 pt-5 pb-4 text-foreground shadow-md"
      }
    >
      <header className="flex items-center justify-between gap-3 pl-1.5">
        <span className="flex min-w-0 items-center gap-1.5 font-semibold">
          <span className="flex size-6 shrink-0 items-center justify-center text-2xl">
            {STATE_ICONS[state]}
          </span>
          <span className="truncate">{t(STATE_TITLES[state])}</span>
        </span>
        <Button size="icon" variant="text" aria-label={t("cancel")} onClick={() => service.hideNotification()}>
          <CloseIcon />
        </Button>
      </header>

      {state === UploadNotificationState.UPLOADING && (
        <div className="flex flex-col gap-3 pl-2">
          <span className="text-sm">{t("wait")}</span>
          <div className="h-1.5 w-full overflow-hidden rounded-lg bg-muted">
            <div
              className="h-full rounded-lg bg-primary transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div>
            <Button size="small" variant="text" className="text-primary" onClick={() => service.interrupt()}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}

      {state === UploadNotificationState.ERROR && (
        <div className="flex flex-col items-start gap-2 pl-2">
          <span className="text-sm">{t("interrupt")}</span>
          {retry}
        </div>
      )}

      {links.length > 0 && (
        <ul className="m-0 flex max-h-72 list-none flex-col gap-2 overflow-y-auto p-0">
          {links.map((item, index) => {
            const content = (
              <>
                <span className="flex size-5 shrink-0 items-center text-xl">
                  <UnitIcon type={item.type} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                {item.link && <ShareRangeIcon className="shrink-0 text-muted-foreground" />}
              </>
            );
            const className = "flex items-center gap-2 rounded px-2 py-1 text-foreground no-underline";
            return (
              <li key={`${index}-${item.name}`}>
                {item.link ? (
                  <a className={`${className} hover:bg-accent`} href={item.link} target="_blank" rel="noreferrer">
                    {content}
                  </a>
                ) : (
                  <span className={className}>{content}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {state === UploadNotificationState.SUCCESS && (
        <div className="flex items-center justify-between gap-3 pl-2">
          <span className="text-sm text-muted-foreground">{t("uploadSuccessTip", `${links.length}`)}</span>
          {retry}
        </div>
      )}
    </section>
  );
}

export interface ExportFormatDialogProps extends ExportTargets {
  readonly formats: readonly ExchangeFormat[];
  readonly mobile: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (format: ExchangeFormat, targetId: string) => Promise<void>;
}

/** XLSX exports the whole Unit; CSV and TSV export one sheet or table. */
export function ExportFormatDialog({
  formats,
  items,
  selectedId: initialSelectedId,
  mobile,
  onCancel,
  onConfirm,
}: ExportFormatDialogProps) {
  const t = useTranslate();
  const [format, setFormat] = useState(formats[0]);
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const options = items.map((item) => ({ ...item }));

  async function confirm() {
    if (exportingRef.current || !format) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      await onConfirm(format, selectedId);
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }

  const actions = (
    <>
      <Button type="button" variant="default" onClick={onCancel}>
        {t("cancel")}
      </Button>
      <Button
        type="button"
        variant="primary"
        aria-busy={exporting}
        disabled={exporting || !format || (format !== ExchangeFormat.XLSX && !selectedId)}
        onClick={() => void confirm()}
      >
        {exporting && <LoadingMultiIcon className="animate-spin" />}
        {t("confirm")}
      </Button>
    </>
  );

  return (
    <div className={mobile ? "grid gap-4" : "flex flex-col gap-5 p-1"}>
      <div className={mobile ? "grid gap-3" : "flex flex-col gap-4"}>
        {formats.map((item) => (
          <div
            key={item}
            className={mobile ? "grid gap-2 rounded-xl bg-muted p-3" : "flex items-center gap-3"}
          >
            <Radio value={item} checked={format === item} onChange={(value) => setFormat(value as ExchangeFormat)}>
              <span className="w-10">{item.toUpperCase()}</span>
            </Radio>
            {item !== ExchangeFormat.XLSX &&
              (mobile ? (
                format === item && (
                  <MobileSelect
                    className="w-full min-w-0"
                    value={selectedId}
                    options={options}
                    onChange={(value) => setSelectedId(String(value))}
                  />
                )
              ) : (
                <Select
                  className="w-48"
                  value={selectedId}
                  options={options}
                  onChange={(value) => setSelectedId(String(value))}
                />
              ))}
          </div>
        ))}
      </div>
      {mobile ? (
        <MobileActionRowGroup className="sticky bottom-0 bg-background py-3">{actions}</MobileActionRowGroup>
      ) : (
        <div className="flex justify-end gap-2">{actions}</div>
      )}
    </div>
  );
}

/** File menu in the Base toolbar, which has no ribbon to merge a menu into. */
export function BaseExchangeToolbarActions({
  onImport,
  onExport,
}: {
  readonly onImport: () => void;
  readonly onExport: () => void;
}) {
  const t = useTranslate();
  const label = t("file");
  const items: IDropdownMenuProps["items"] = [
    {
      type: "item",
      children: (
        <span className="flex items-center gap-2">
          <FolderIcon />
          {t("upload")}
        </span>
      ),
      onSelect: onImport,
    },
    {
      type: "item",
      children: (
        <span className="flex items-center gap-2">
          <ExportIcon />
          {t("download")}
        </span>
      ),
      onSelect: onExport,
    },
  ];
  return (
    <Tooltip title={label} placement="top">
      <DropdownMenu items={items}>
        <Button type="button" variant="text" className="h-8 gap-1 px-2" aria-label={label}>
          <DirectExportIcon />
          <MoreDownIcon className="size-3" />
        </Button>
      </DropdownMenu>
    </Tooltip>
  );
}
