/** Schema from the original Workspace Agent registration. */
export const lintParameters = {
  "type": "object",
  "properties": {
    "unitId": {
      "type": "string",
      "description": "Explicit Slide Unit id from univer_status."
    },
    "unitType": {
      "type": "string",
      "description": "Must be slide for layout lint.",
      "enum": [
        "sheet",
        "doc",
        "slide",
        "board",
        "base"
      ]
    },
    "worktreeId": {
      "type": "string",
      "description": "Optional draft Worktree scope; omit for trunk."
    },
    "pages": {
      "type": "array",
      "description": "Optional 1-based page numbers or page ids.",
      "items": {
        "oneOf": [
          {
            "type": "integer"
          },
          {
            "type": "string"
          }
        ]
      }
    }
  },
  "required": [
    "unitId",
    "unitType"
  ]
} as const;
