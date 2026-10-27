import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools';
export const svgParameters: ObjectJsonSchema = {
  "type": "object",
  "properties": {
    "source": {
      "type": "string",
      "description": "SVG path inside the session workspace."
    },
    "worktreeId": {
      "type": "string",
      "description": "Writable draft Worktree id."
    },
    "unitId": {
      "type": "string",
      "description": "Explicit Slide Unit id."
    },
    "page": {
      "type": "integer",
      "description": "1-based Slide page number."
    },
    "mode": {
      "type": "string",
      "enum": [
        "replace",
        "add"
      ]
    }
  },
  "required": [
    "source",
    "unitId",
    "page"
  ]
};
