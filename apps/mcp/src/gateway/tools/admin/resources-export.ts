import { isResourceLibraryError } from "@univer-cli/resource-library";
import { z } from "zod";
import { decodeCursor, encodeCursor, fitsPage, resultTooLarge } from "../../paging.js";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";

const inputSchema = z.object({
  handles: z
    .array(z.string().min(1))
    .min(1)
    .describe("Resource handles (<registryId>/<resourceId>) from resources_find."),
  cursor: z
    .string()
    .optional()
    .describe(
      "The cursor of a truncated result. Repeat the call with the same handles to continue.",
    ),
});
type Exported = { handle: string; svg: string };
type Failed = { handle: string; code: string; message: string };

export const resourcesExportTool: ToolDefinition = {
  name: "resources_export",
  toolset: "admin",
  scope: "read",
  title: "Export SVG resources",
  description:
    "Return the SVG text of catalog resources by handle, in order. Unknown or unreadable handles are listed in failed. Nothing is written to disk. A long result has truncated: true and a cursor; call again with the same handles and that cursor to continue.",
  inputSchema,
  outputSchema: z.object({
    resources: z.array(z.object({ handle: z.string(), svg: z.string() })),
    failed: z.array(z.object({ handle: z.string(), code: z.string(), message: z.string() })),
    truncated: z.boolean().optional(),
    cursor: z.string().optional(),
  }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { handles, cursor } = inputSchema.parse(args);
    const library = context.resources();
    const start = decodeCursor(cursor, "resources_export", { handles }, handles.length);
    const resources: Exported[] = [];
    const failed: Failed[] = [];
    let next = start;
    for (; next < handles.length; next += 1) {
      const handle = handles[next] as string;
      let target: Exported[] | Failed[] = resources;
      try {
        resources.push(await library.read({ handle }));
      } catch (error) {
        if (!isResourceLibraryError(error)) throw error;
        target = failed;
        failed.push({ handle, code: error.code, message: error.message });
      }
      if (!fitsPage({ resources, failed })) {
        target.pop();
        break;
      }
    }
    if (next === start) {
      throw resultTooLarge(
        "resources_export",
        `The SVG for ${handles[start] as string} alone does not fit.`,
      );
    }
    const page = { resources, failed };
    return {
      output:
        next < handles.length
          ? { ...page, truncated: true, cursor: encodeCursor("resources_export", { handles }, next) }
          : page,
      repo: null,
    };
  },
};
