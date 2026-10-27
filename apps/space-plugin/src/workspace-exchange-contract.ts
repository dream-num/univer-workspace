import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools';
export const importParameters: ObjectJsonSchema = {
  "type": "object",
  "properties": {
    "source": {
      "type": "string",
      "description": "Path to the Office source file relative to the session workspace."
    },
    "file": {
      "type": "string",
      "description": "Optional Office-compatible logical target path; remote Units are identified by the returned unitId/resourceId."
    },
    "worktreeId": {
      "type": "string",
      "description": "Writable draft Worktree id."
    },
    "name": {
      "type": "string",
      "description": "Non-empty name for the imported Unit."
    },
    "spaceId": {
      "type": "string",
      "description": "Optional target Space; omit to use the linked Space, or provide a Space accessible to the authenticated User."
    },
    "parentNodeId": {
      "type": "string",
      "description": "Optional target folder Node id."
    },
    "unitType": {
      "type": "string",
      "description": "Optional explicit type; otherwise infer it from the source extension.",
      "enum": [
        "sheet",
        "doc",
        "slide",
        "base"
      ]
    },
    "type": {
      "type": "string",
      "description": "Deprecated alias for unitType.",
      "enum": [
        "auto",
        "sheet",
        "doc",
        "slide",
        "base"
      ]
    },
    "idempotencyKey": {
      "type": "string",
      "description": "Optional stable key for retry-safe Worktree Unit creation."
    }
  },
  "required": [
    "source",
    "name"
  ]
};
export const exportParameters: ObjectJsonSchema = {
  "type": "object",
  "properties": {
    "file": {
      "type": "string",
      "description": "Optional Office-compatible logical source path; not required for a remote Unit."
    },
    "output": {
      "type": "string",
      "description": "Destination path relative to the session workspace (preferred Office-compatible spelling)."
    },
    "unitId": {
      "type": "string",
      "description": "Explicit Unit id from univer_open/univer_status."
    },
    "unitID": {
      "type": "string",
      "description": "Deprecated alias for unitId."
    },
    "worktreeId": {
      "type": "string",
      "description": "Optional Worktree scope; omit to export the linked Space's trunk Unit."
    },
    "type": {
      "type": "string",
      "description": "Optional type assertion; the server-resolved Unit type is authoritative.",
      "enum": [
        "sheet",
        "doc",
        "slide",
        "base"
      ]
    },
    "format": {
      "type": "string",
      "description": "Optional format assertion; normally inferred from output extension.",
      "enum": [
        "xlsx",
        "csv",
        "tsv",
        "docx",
        "pptx"
      ]
    },
    "revision": {
      "type": "integer",
      "description": "Optional expected revision; reject export if the Unit has advanced."
    }
  }
};
