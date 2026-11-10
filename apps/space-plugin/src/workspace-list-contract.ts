import type { JsonSchemaNode, ObjectJsonSchema } from '@deepseek-ai/dsh-tools';

/** JSON Schema generated from the original Workspace Agent tool definition. */
export const workspaceListParameters: ObjectJsonSchema = {
  "type": "object",
  "properties": {
    "spaceId": {
      "type": "string",
      "description": "Optional. Omit to list the Space linked to this session; an explicit value may select any Space accessible to the authenticated User."
    },
    "parentNodeId": {
      "type": "string"
    },
    "recursive": {
      "type": "boolean"
    },
    "query": {
      "type": "string"
    },
    "resourceKind": {
      "type": "string",
      "enum": [
        "univer",
        "blob",
        "folder",
        "all"
      ]
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
    }
  }
};

export const workspaceListOutput: JsonSchemaNode = {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "spaceId": {
      "type": "string"
    },
    "documents": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "nodeId": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "parentNodeId": {
            "oneOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "hasChildren": {
            "type": "boolean"
          },
          "updatedAt": {
            "oneOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "resourceId": {
            "type": "string"
          },
          "resourceKind": {
            "type": "string",
            "enum": [
              "univer",
              "blob"
            ]
          },
          "unitType": {
            "type": "string"
          },
          "mediaType": {
            "type": "string"
          },
          "byteSize": {
            "type": "number"
          },
          "availability": {
            "type": "string"
          },
          "accessRole": {
            "type": "string"
          },
          "nodeCapabilities": {},
          "resourceCapabilities": {}
        },
        "required": [
          "nodeId",
          "name",
          "parentNodeId",
          "hasChildren",
          "updatedAt",
          "resourceId",
          "resourceKind",
          "accessRole"
        ]
      }
    },
    "folders": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "nodeId": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "parentNodeId": {
            "oneOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "hasChildren": {
            "type": "boolean"
          },
          "updatedAt": {
            "oneOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "accessRole": {
            "type": "string"
          },
          "nodeCapabilities": {}
        },
        "required": [
          "nodeId",
          "name",
          "parentNodeId",
          "hasChildren",
          "updatedAt",
          "accessRole"
        ]
      }
    }
  },
  "required": [
    "spaceId",
    "documents",
    "folders"
  ]
};
