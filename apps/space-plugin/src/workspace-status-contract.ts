/** Schema from the original Workspace Agent registration. */
export const statusParameters = {
  "type": "object",
  "properties": {
    "resourceId": {
      "type": "string"
    },
    "worktreeId": {
      "type": "string"
    },
    "unitId": {
      "type": "string",
      "description": "Optional Unit filter inside the selected Worktree."
    }
  }
} as const;
