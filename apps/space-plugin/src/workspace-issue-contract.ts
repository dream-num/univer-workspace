/** Schema from the original Workspace Agent registration. */
export const issueParameters = {
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "list",
        "get",
        "create",
        "update",
        "comment",
        "close",
        "reopen"
      ]
    },
    "spaceId": {
      "type": "string",
      "description": "Team Space id. Defaults to the Space linked to this session."
    },
    "scope": {
      "type": "string",
      "description": "list only. `space` (default) lists one Space; `mine` lists across every Team Space the user belongs to, e.g. with assignee=me.",
      "enum": [
        "space",
        "mine"
      ]
    },
    "number": {
      "type": "integer",
      "description": "Issue number, the N in #N."
    },
    "state": {
      "type": "string",
      "description": "list filter; default open.",
      "enum": [
        "open",
        "closed",
        "all"
      ]
    },
    "assignee": {
      "type": "string",
      "description": "list filter: `me`, `none`, or a user id."
    },
    "search": {
      "type": "string",
      "description": "list filter on title and body."
    },
    "limit": {
      "type": "integer"
    },
    "title": {
      "type": "string"
    },
    "body": {
      "type": "string",
      "description": "Markdown. For comment, the comment text."
    },
    "labels": {
      "type": "array",
      "description": "create: label names, or list filter.",
      "items": {
        "type": "string"
      }
    },
    "assignees": {
      "type": "array",
      "description": "create: `me` or user ids.",
      "items": {
        "type": "string"
      }
    },
    "resourceIds": {
      "type": "array",
      "description": "create: Univer files to link.",
      "items": {
        "type": "string"
      }
    },
    "nodeIds": {
      "type": "array",
      "description": "create: other Nodes to link.",
      "items": {
        "type": "string"
      }
    },
    "addLabels": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "removeLabels": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "addAssignees": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "removeAssignees": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "addResourceIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "removeResourceIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "addNodeIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "removeNodeIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "reason": {
      "type": "string",
      "description": "close only; default completed.",
      "enum": [
        "completed",
        "not_planned"
      ]
    },
    "comment": {
      "type": "string",
      "description": "close only: a final comment posted first."
    }
  },
  "required": [
    "action"
  ]
} as const;
