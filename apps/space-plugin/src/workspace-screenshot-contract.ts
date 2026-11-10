/** Schema from the original Workspace Agent registration. */
export const screenshotParameters = {
  "type": "object",
  "properties": {
    "unitId": {
      "type": "string",
      "description": "Explicit Unit id from univer_status."
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
    "worktreeId": {
      "type": "string",
      "description": "Optional draft Worktree scope; omit for trunk."
    },
    "output": {
      "type": "string",
      "description": "Session-relative output directory for PNG files."
    },
    "sheetName": {
      "type": "string"
    },
    "range": {
      "type": "string",
      "description": "Sheet A1 range, e.g. B2:H40."
    },
    "pages": {
      "type": "array",
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
    },
    "contactSheet": {
      "type": "boolean"
    },
    "tileColumns": {
      "type": "integer"
    },
    "tileRows": {
      "type": "integer"
    },
    "region": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "left": {
          "type": "number"
        },
        "top": {
          "type": "number"
        },
        "width": {
          "type": "number"
        },
        "height": {
          "type": "number"
        }
      },
      "required": [
        "left",
        "top",
        "width",
        "height"
      ]
    },
    "elementIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "padding": {
      "type": "number"
    },
    "scale": {
      "type": "number",
      "description": "Render scale from 0.1 to 4."
    }
  },
  "required": [
    "unitId",
    "unitType",
    "output"
  ]
} as const;
