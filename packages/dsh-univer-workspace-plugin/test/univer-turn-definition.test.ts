import { describe, expect, it } from "vitest";
import { latestUnitTurns, mergeFiles, unitIdentityOfTurnFile, univerTurnDefinition } from "../src/client/conversation/univer-turn-definition.ts";

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
          content: [{
            toolCallId: CALL_ID,
            isError: false,
            content: [{
              type: "text",
              text: JSON.stringify({
                nodeId: "node-1",
                resourceId: RESOURCE_ID,
                unitId: UNIT_ID,
                unitType: "sheet",
                name: "Demo Sheet",
                editorMode: "edit",
              }),
            }],
          }],
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

    expect(completed.files).toEqual([{
      docKey: `res:${RESOURCE_ID}`,
      operations: [{
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
      }],
    }]);
  });

  it("folds Worktree operations into the document card", () => {
    const files = mergeFiles([
      {
        docKey: `res:${RESOURCE_ID}`,
        operations: [{
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
        }],
      },
      {
        docKey: "wt:wt-1",
        operations: [{
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
        }],
      },
    ]);
    expect(files).toHaveLength(1);
    expect(files[0]?.docKey).toBe(`res:${RESOURCE_ID}`);
    expect(files[0]?.operations.map((operation) => operation.action)).toEqual(["create", "ready"]);
  });

  it("folds unitId aliases into the resource card", () => {
    const files = mergeFiles([
      {
        docKey: `res:${RESOURCE_ID}`,
        operations: [{
          callId: "open-resource", name: "open", action: null,
          docKey: `res:${RESOURCE_ID}`, label: "Demo Sheet", unitType: "sheet",
          resourceId: RESOURCE_ID, worktreeId: null, unitId: UNIT_ID,
          readOnly: true, phase: "succeeded",
        }],
      },
      {
        docKey: `unit:${UNIT_ID}`,
        operations: [{
          callId: "edit-unit", name: "execute", action: null,
          docKey: `unit:${UNIT_ID}`, label: "Demo Sheet", unitType: "sheet",
          resourceId: null, worktreeId: "wt-2", unitId: UNIT_ID,
          readOnly: false, phase: "succeeded",
        }],
      },
    ]);
    expect(files).toHaveLength(1);
    expect(files[0]?.docKey).toBe(`res:${RESOURCE_ID}`);
  });

  it("folds repeated turns for one Unit into the latest viewer card", () => {
    const firstTurn: any = {
      data: new Map([["univerTurn", {
        files: [{
          docKey: `res:${RESOURCE_ID}`,
          operations: [{
            callId: "open-1", name: "open", action: null,
            docKey: `res:${RESOURCE_ID}`, label: "Demo Sheet", unitType: "sheet",
            resourceId: RESOURCE_ID, worktreeId: null, unitId: UNIT_ID,
            readOnly: true, phase: "succeeded",
          }],
        }],
      }]]),
    };
    const secondFile: any = {
      docKey: `unit:${UNIT_ID}`,
      operations: [{
        callId: "edit-2", name: "execute", action: null,
        docKey: `unit:${UNIT_ID}`, label: "Demo Sheet", unitType: "sheet",
        resourceId: null, worktreeId: "wt-2", unitId: UNIT_ID,
        readOnly: false, phase: "succeeded",
      }],
    };
    const secondTurn: any = { data: new Map([["univerTurn", { files: [secondFile] }]]) };
    const session: any = { chat: { timeline: { turns: new Map([[1, firstTurn], [2, secondTurn]]) } } };

    const latest = latestUnitTurns(session);
    expect(latest.get(`res:${RESOURCE_ID}`)).toBe(2);
    expect(unitIdentityOfTurnFile(firstTurn.data.get("univerTurn").files[0], session)).toBe(`res:${RESOURCE_ID}`);
    expect(unitIdentityOfTurnFile(secondFile, session)).toBe(`res:${RESOURCE_ID}`);
  });

  it("keeps a Worktree-local Unit on the Worktree state route until it is merged", () => {
    const files = mergeFiles([
      {
        docKey: "name:Draft",
        operations: [{
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
        }],
      },
      {
        docKey: "unit:local-unit",
        operations: [{
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
        }],
      },
    ]);
    expect(files).toHaveLength(1);
    expect(files[0]?.docKey).toBe("wt:wt-local");
    expect(unitIdentityOfTurnFile(files[0]!, { chat: { timeline: { turns: new Map() } } })).toBe("wt:wt-local");
  });
});
