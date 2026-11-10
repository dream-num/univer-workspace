import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools';
export const blobParameters: ObjectJsonSchema = {
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "get",
        "download",
        "upload",
        "replace"
      ]
    },
    "resourceId": {
      "type": "string",
      "description": "Required for get, download and replace."
    },
    "file": {
      "type": "string",
      "description": "Required session-relative input for upload/replace or output for download."
    },
    "spaceId": {
      "type": "string",
      "description": "Upload destination; defaults to the current Space."
    },
    "parentNodeId": {
      "type": "string",
      "description": "Upload destination folder; defaults to the Space root."
    },
    "name": {
      "type": "string",
      "description": "Uploaded Blob name; defaults to the input filename."
    },
    "etag": {
      "type": "string",
      "description": "Exact quoted ETag returned by download; required for replace."
    },
    "idempotencyKey": {
      "type": "string",
      "description": "Required for upload and replace: 16\u2013200 ASCII letters, digits, underscores or hyphens (for example a UUID). Reuse only for an identical write retry."
    }
  },
  "required": [
    "action"
  ]
};
