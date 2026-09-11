import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  WORKTREE_CHANGE_FEED_PATH,
  isWorktreeMutation,
} from "../src/integrations/worktree-change-feed.ts";

describe("worktree change feed routing helpers", () => {
  test("identifies product mutations that must notify the feed", () => {
    assert.equal(isWorktreeMutation("/api/worktrees", "POST"), true);
    assert.equal(isWorktreeMutation("/api/worktrees/wt_1/discard", "POST"), true);
    assert.equal(isWorktreeMutation("/api/worktrees", "GET"), false);
    assert.equal(isWorktreeMutation("/api/worktrees/wt_1", "GET"), false);
    assert.equal(isWorktreeMutation("/api/nodes", "POST"), false);
  });

  test("keeps the browser WebSocket path stable", () => {
    assert.equal(WORKTREE_CHANGE_FEED_PATH, "/api/worktree-events");
  });
});
