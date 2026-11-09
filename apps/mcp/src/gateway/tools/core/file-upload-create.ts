import { uploadInputSchema, uploadLinkSchema } from "../../staging/model.js";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { stagingStore } from "../files/staging-support.js";
export const fileUploadCreateTool: ToolDefinition = {
  name: "file_upload_create",
  toolset: "core",
  scope: "write",
  title: "Prepare a file upload",
  description:
    "Reserve an upload. Optional size is an upper limit, not an exact length. PUT the file bytes to upload_url (Content-Length optional), or give page_url to the user to upload in a browser. Both capability links expire in 10 minutes. Then pass upload_id to a tool for the same purpose within one hour. Keep the links private.",
  inputSchema: uploadInputSchema,
  outputSchema: uploadLinkSchema,
  annotations: writeAnnotations,
  async run(context, args) {
    return {
      output: await stagingStore(context).createUpload(
        context.user.id,
        uploadInputSchema.parse(args),
      ),
      repo: null,
    };
  },
};
