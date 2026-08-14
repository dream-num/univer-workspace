import { DocumentFlavor, LocaleType } from "@univerjs/core";
import { describe, expect, it } from "vitest";
import { createDocumentInitialData } from "./create-document-initial-data.js";

describe("createDocumentInitialData", () => {
  it.each([
    {
      expectedFlavor: DocumentFlavor.MODERN,
      expectedLocale: LocaleType.ZH_CN,
      language: "zh-CN" as const,
      mode: "modern" as const,
    },
    {
      expectedFlavor: DocumentFlavor.TRADITIONAL,
      expectedLocale: LocaleType.EN_US,
      language: "en-US" as const,
      mode: "classic" as const,
    },
  ])(
    "creates complete $mode document data",
    async ({ expectedFlavor, expectedLocale, language, mode }) => {
      const initialData = await createDocumentInitialData({
        language,
        mode,
        title: "Project brief",
      });

      expect(initialData).toMatchObject({
        body: {
          dataStream: "\r\n",
          paragraphs: expect.any(Array),
          sectionBreaks: expect.any(Array),
        },
        documentStyle: { documentFlavor: expectedFlavor },
        locale: expectedLocale,
        title: "Project brief",
      });
    }
  );
});
