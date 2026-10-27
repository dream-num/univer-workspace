import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools';
export const htmlViewParameters: ObjectJsonSchema = {
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "validate",
        "create"
      ]
    },
    "source": {
      "type": "string",
      "description": "Session-relative .univer.html source file for validate/create."
    },
    "name": {
      "type": "string",
      "description": "Name for create; .univer.html is added if missing."
    },
    "spaceId": {
      "type": "string",
      "description": "Destination Space, defaults to current linked Space."
    },
    "parentNodeId": {
      "type": "string",
      "description": "Optional destination folder Node."
    },
    "idempotencyKey": {
      "type": "string",
      "description": "Required for create: 16\u2013200 ASCII letters, digits, underscores or hyphens (for example a UUID). Reuse only when retrying identical content and destination."
    }
  },
  "required": [
    "action"
  ]
};
