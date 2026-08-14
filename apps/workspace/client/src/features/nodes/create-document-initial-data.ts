import type { IDocumentData } from "@univerjs/core";
import type { AppLanguage } from "../../shared/i18n";

export type NewDocumentMode = "modern" | "classic";

const CLIENT_PLACEHOLDER_DOCUMENT_ID = "workspace-new-document";

export async function createDocumentInitialData(input: {
  readonly language: AppLanguage;
  readonly mode: NewDocumentMode;
  readonly title: string;
}): Promise<IDocumentData> {
  const { DocumentFlavor, LocaleType, getDocsEmptySnapshot } = await import(
    "@univerjs/core"
  );
  const documentFlavor =
    input.mode === "classic"
      ? DocumentFlavor.TRADITIONAL
      : DocumentFlavor.MODERN;
  const locale =
    input.language === "zh-CN" ? LocaleType.ZH_CN : LocaleType.EN_US;

  return getDocsEmptySnapshot(
    CLIENT_PLACEHOLDER_DOCUMENT_ID,
    locale,
    input.title,
    documentFlavor
  );
}
