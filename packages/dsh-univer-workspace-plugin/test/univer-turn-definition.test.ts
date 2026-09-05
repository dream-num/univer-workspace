import { describe, expect, it } from "vitest";
import {
  latestUnitTurns,
  mergeFiles,
  turnFilesOfConversation,
  unitIdentityOfTurnFile,
  univerTurnDefinition,
} from "../src/client/conversation/univer-turn-definition.ts";

const RESOURCE_ID = "4184c81c-6bc6-45c8-86a6-e909437f58f6";
const UNIT_ID = "073daf66-b8f8-4143-9f70-83c304351439";
const CALL_ID = "call-open";

function turnStart(): any {
  return { event: { type: "turn/start", data: { turn: 1 } } };
}

function toolCall(): any {
  return {
    event: {
      type: "tool/call",
      data: {
        turn: 1,
        callId: CALL_ID,
        name: "univer_open",
        arguments: JSON.stringify({ resourceId: RESOURCE_ID }),
      },
    },
  };
}

function toolResult(): any {
  return {
    event: {
      type: "tool/result",
      data: {
        turn: 1,
        message: {
          content: [
            {
              toolCallId: CALL_ID,
              isError: false,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    nodeId: "node-1",
                    resourceId: RESOURCE_ID,
                    unitId: UNIT_ID,
                    unitType: "sheet",
                    name: "Demo Sheet",
                    editorMode: "edit",
                  }),
                },
              ],
            },
          ],
        },
      },
    },
  };
}

describe("univer turn projection", () => {
  it("keeps the resource identity from a direct univer_open result", () => {
    const started = univerTurnDefinition.start({} as any, turnStart());
    const withCall = univerTurnDefinition.update({ state: started } as any, toolCall());
    const completed = univerTurnDefinition.update({ state: withCall } as any, toolResult());

    expect(completed.files).toEqual([
      {
        docKey: `res:${RESOURCE_ID}`,
        operations: [
          {
            callId: CALL_ID,
            name: "open",
            action: null,
            docKey: `res:${RESOURCE_ID}`,
            label: "Demo Sheet",
            unitType: "sheet",
            resourceId: RESOURCE_ID,
            worktreeId: null,
            unitId: UNIT_ID,
            readOnly: false,
            phase: "succeeded",
          },
        ],
      },
    ]);
  });

  it("keeps Worktree lifecycle operations on the Worktree card", () => {
    const files = mergeFiles([
      {
        docKey: `res:${RESOURCE_ID}`,
        operations: [
          {
            callId: "create-worktree",
            name: "worktree",
            action: "create",
            docKey: `res:${RESOURCE_ID}`,
            label: "Demo Sheet",
            unitType: "sheet",
            resourceId: RESOURCE_ID,
            worktreeId: "wt-1",
            unitId: UNIT_ID,
            readOnly: false,
            phase: "succeeded",
          },
        ],
      },
      {
        docKey: "wt:wt-1",
        operations: [
          {
            callId: "ready-worktree",
            name: "worktree",
            action: "ready",
            docKey: "wt:wt-1",
            label: null,
            unitType: null,
            resourceId: null,
            worktreeId: "wt-1",
            unitId: null,
            readOnly: false,
            phase: "succeeded",
          },
        ],
      },
      {
        docKey: `res:${RESOURCE_ID}`,
        operations: [
          {
            callId: "merge-worktree",
            name: "worktree",
            action: "merge",
            docKey: `res:${RESOURCE_ID}`,
            label: "Demo Sheet",
            unitType: "sheet",
            resourceId: RESOURCE_ID,
            worktreeId: "wt-1",
            unitId: UNIT_ID,
            readOnly: true,
            phase: "succeeded",
          },
        ],
      },
    ]);
    expect(files).toHaveLength(1);
    expect(files[0]?.docKey).toBe("wt:wt-1");
    expect(files[0]?.operations.map((operation) => operation.action)).toEqual([
      "create",
      "ready",
      "merge",
    ]);
  });

  it("folds trunk unitId aliases into the Resource card", () => {
    const files = mergeFiles([
      {
        docKey: `res:${RESOURCE_ID}`,
        operations: [
          {
            callId: "open-resource",
            name: "open",
            action: null,
            docKey: `res:${RESOURCE_ID}`,
            label: "Demo Sheet",
            unitType: "sheet",
            resourceId: RESOURCE_ID,
            worktreeId: null,
            unitId: UNIT_ID,
            readOnly: true,
            phase: "succeeded",
          },
        ],
      },
      {
        docKey: `unit:${UNIT_ID}`,
        operations: [
          {
            callId: "edit-unit",
            name: "execute",
            action: null,
            docKey: `unit:${UNIT_ID}`,
            label: "Demo Sheet",
            unitType: "sheet",
            resourceId: null,
            worktreeId: null,
            unitId: UNIT_ID,
            readOnly: false,
            phase: "succeeded",
          },
        ],
      },
    ]);
    expect(files).toHaveLength(1);
    expect(files[0]?.docKey).toBe(`res:${RESOURCE_ID}`);
  });

  it("keeps trunk and different Worktrees separate while aggregating Units per Worktree", () => {
    const files = mergeFiles([
      {
        docKey: `res:${RESOURCE_ID}`,
        operations: [
          {
            callId: "open-trunk",
            name: "open",
            action: null,
            docKey: `res:${RESOURCE_ID}`,
            label: "Demo Sheet",
            unitType: "sheet",
            resourceId: RESOURCE_ID,
            worktreeId: null,
            unitId: UNIT_ID,
            readOnly: true,
            phase: "succeeded",
          },
        ],
      },
      {
        docKey: `unit:${UNIT_ID}`,
        operations: [
          {
            callId: "edit-wt-1-unit-1",
            name: "execute",
            action: null,
            docKey: `unit:${UNIT_ID}`,
            label: "Demo Sheet",
            unitType: "sheet",
            resourceId: RESOURCE_ID,
            worktreeId: "wt-1",
            unitId: UNIT_ID,
            readOnly: false,
            phase: "succeeded",
          },
        ],
      },
      {
        docKey: "unit:second-unit",
        operations: [
          {
            callId: "edit-wt-1-unit-2",
            name: "execute",
            action: null,
            docKey: "unit:second-unit",
            label: "Summary",
            unitType: "doc",
            resourceId: "second-resource",
            worktreeId: "wt-1",
            unitId: "second-unit",
            readOnly: false,
            phase: "succeeded",
          },
        ],
      },
      {
        docKey: `unit:${UNIT_ID}`,
        operations: [
          {
            callId: "edit-wt-2-unit-1",
            name: "execute",
            action: null,
            docKey: `unit:${UNIT_ID}`,
            label: "Demo Sheet",
            unitType: "sheet",
            resourceId: RESOURCE_ID,
            worktreeId: "wt-2",
            unitId: UNIT_ID,
            readOnly: false,
            phase: "succeeded",
          },
        ],
      },
    ]);

    expect(files.map((file) => file.docKey)).toEqual([`res:${RESOURCE_ID}`, "wt:wt-1", "wt:wt-2"]);
    expect(files[1]?.operations.map((operation) => operation.unitId)).toEqual([
      UNIT_ID,
      "second-unit",
    ]);
  });

  it("tracks trunk and Worktree projections independently across Turns", () => {
    const firstTurn: any = {
      data: new Map([
        [
          "univerTurn",
          {
            files: [
              {
                docKey: `res:${RESOURCE_ID}`,
                operations: [
                  {
                    callId: "open-1",
                    name: "open",
                    action: null,
                    docKey: `res:${RESOURCE_ID}`,
                    label: "Demo Sheet",
                    unitType: "sheet",
                    resourceId: RESOURCE_ID,
                    worktreeId: null,
                    unitId: UNIT_ID,
                    readOnly: true,
                    phase: "succeeded",
                  },
                ],
              },
            ],
          },
        ],
      ]),
    };
    const secondFile: any = {
      docKey: `unit:${UNIT_ID}`,
      operations: [
        {
          callId: "edit-2",
          name: "execute",
          action: null,
          docKey: `unit:${UNIT_ID}`,
          label: "Demo Sheet",
          unitType: "sheet",
          resourceId: null,
          worktreeId: "wt-2",
          unitId: UNIT_ID,
          readOnly: false,
          phase: "succeeded",
        },
      ],
    };
    const secondTurn: any = { data: new Map([["univerTurn", { files: [secondFile] }]]) };
    const session: any = {
      chat: {
        timeline: {
          turns: new Map([
            [1, firstTurn],
            [2, secondTurn],
          ]),
        },
      },
    };

    const latest = latestUnitTurns(session);
    expect(latest.get(`res:${RESOURCE_ID}`)).toBe(1);
    expect(latest.get("wt:wt-2")).toBe(2);
    expect(unitIdentityOfTurnFile(firstTurn.data.get("univerTurn").files[0], session)).toBe(
      `res:${RESOURCE_ID}`,
    );
    expect(unitIdentityOfTurnFile(secondFile, session)).toBe("wt:wt-2");
  });

  it("reads Turn files from the public Conversation chat view snapshot", () => {
    const file: any = {
      docKey: `res:${RESOURCE_ID}`,
      operations: [
        {
          callId: "create-from-real-conversation",
          name: "new",
          action: null,
          docKey: `res:${RESOURCE_ID}`,
          label: "Demo Sheet",
          unitType: "sheet",
          resourceId: RESOURCE_ID,
          worktreeId: null,
          unitId: UNIT_ID,
          readOnly: false,
          phase: "succeeded",
        },
      ],
    };
    const chat = {
      timeline: {
        turns: new Map([[1, { data: new Map([["univerTurn", { files: [file] }]]) }]]),
      },
    };
    const conversation = {
      views: {
        get(target: string) {
          return target === "chat" ? chat : undefined;
        },
      },
      activeTargets: new Set(["chat"]),
    };

    expect(turnFilesOfConversation(conversation)).toEqual([file]);
  });

  it("keeps a Worktree-local Unit on the Worktree state route until it is merged", () => {
    const files = mergeFiles([
      {
        docKey: "name:Draft",
        operations: [
          {
            callId: "create-local",
            name: "unit",
            action: "create",
            docKey: "name:Draft",
            label: "Draft",
            unitType: "sheet",
            resourceId: "reserved-resource",
            worktreeId: "wt-local",
            unitId: "local-unit",
            source: "worktree",
            readOnly: false,
            phase: "succeeded",
          },
        ],
      },
      {
        docKey: "unit:local-unit",
        operations: [
          {
            callId: "edit-local",
            name: "execute",
            action: null,
            docKey: "unit:local-unit",
            label: "Draft",
            unitType: "sheet",
            resourceId: "reserved-resource",
            worktreeId: "wt-local",
            unitId: "local-unit",
            source: "worktree",
            readOnly: false,
            phase: "succeeded",
          },
        ],
      },
    ]);
    expect(files).toHaveLength(1);
    expect(files[0]?.docKey).toBe("wt:wt-local");
    expect(unitIdentityOfTurnFile(files[0]!, { chat: { timeline: { turns: new Map() } } })).toBe(
      "wt:wt-local",
    );
  });
});
