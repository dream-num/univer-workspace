/** Schema from the original Workspace Agent registration. */
export const unitParameters = {
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "create",
        "remove",
        "restore"
      ]
    },
    "worktreeId": {
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
    "unitId": {
      "type": "string",
      "description": "Required for remove or restore; use the Unit ID from Worktree detail."
    },
    "spaceId": {
      "type": "string"
    },
    "parentNodeId": {
      "type": "string"
    },
    "initialData": {},
    "idempotencyKey": {
      "type": "string",
      "description": "Optional stable key for retry-safe creation."
    }
  },
  "required": [
    "action",
    "worktreeId"
  ]
} as const;
