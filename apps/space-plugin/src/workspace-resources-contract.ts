import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools';
export const resourcesParameters: ObjectJsonSchema = {
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "description": "Resource-library operation.",
      "enum": [
        "registries",
        "find",
        "read",
        "export",
        "clear-cache"
      ]
    },
    "queries": {
      "type": "array",
      "description": "Non-empty search terms for find.",
      "items": {
        "type": "string"
      }
    },
    "registries": {
      "type": "array",
      "description": "Optional registry ids for find.",
      "items": {
        "type": "string"
      }
    },
    "limit": {
      "type": "integer",
      "description": "Optional positive result limit for find."
    },
    "handle": {
      "type": "string",
      "description": "One resource handle for read."
    },
    "handles": {
      "type": "array",
      "description": "Resource handles for export.",
      "items": {
        "type": "string"
      }
    },
    "output": {
      "type": "string",
      "description": "Session-relative output directory for export."
    }
  },
  "required": [
    "action"
  ]
};
