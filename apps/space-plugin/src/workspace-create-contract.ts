import type { JsonSchemaNode, ObjectJsonSchema } from '@deepseek-ai/dsh-tools';

/** Original Workspace create schema; the current Space may supply spaceId. */
export const workspaceCreateParameters: ObjectJsonSchema = {
  "type": "object",
  "properties": {
    "spaceId": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "unitType": {
      "type": "string",
      "enum": [
        "sheet",
        "doc",
        "slide",
        "board",
        "base"
      ]
    },
    "parentNodeId": {
      "type": "string"
    }
  },
  "required": [
    "name",
    "unitType"
  ]
};

export const workspaceCreateOutput: JsonSchemaNode = {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "resourceId": {
      "type": "string"
    },
    "unitId": {
      "type": "string"
    },
    "nodeId": {
      "type": "string"
    }
  }
};
