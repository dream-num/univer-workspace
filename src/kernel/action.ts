/**
 * Cordis Universal Action Engine.
 * Unifies Host RPC methods and LLM Agent Tools into reversible actions with inverse execution.
 */
import { Context, Service } from "@deepseek-ai/cordis";
import type { SqlExec } from "./sql.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    action: ActionService;
  }
}

export interface ActionMeta {
  userId?: string;
  clientId?: string;
  unitId?: string;
  worktreeId?: string;
}

export interface ActionDefinition<TInput = any, TOutput = any> {
  id: string;
  name: string;
  description: string;
  schema?: Record<string, unknown>;
  permissions?: string[];
  exposeAsTool?: boolean;
  exposeAsRpc?: boolean;
  execute: (input: TInput, meta: ActionMeta) => Promise<TOutput>;
  reverse?: (input: TInput, result: TOutput, meta: ActionMeta) => Promise<void>;
}

export interface ActionExecutionJournalEntry {
  actionId: string;
  input: any;
  result: any;
  meta: ActionMeta;
  timestamp: number;
}

export class ActionService extends Service {
  private actions = new Map<string, ActionDefinition>();
  private journal: ActionExecutionJournalEntry[] = [];

  constructor(ctx: Context, private readonly sql?: SqlExec) {
    super(ctx, "action", true);
    this.initJournalSql();
  }

  private initJournalSql(): void {
    if (!this.sql) return;
    try {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS action_journal (
          id TEXT PRIMARY KEY,
          action_id TEXT NOT NULL,
          input TEXT NOT NULL,
          result TEXT,
          meta TEXT NOT NULL,
          reverted INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_action_journal_created ON action_journal(created_at DESC);
      `);
    } catch (err) {
      console.warn("Action journal SQL init warning:", err);
    }
  }

  /**
   * Registers a universal action.
   */
  register<TInput = any, TOutput = any>(def: ActionDefinition<TInput, TOutput>): () => void {
    this.actions.set(def.id, def);
    return () => {
      this.actions.delete(def.id);
    };
  }

  getAction(id: string): ActionDefinition | undefined {
    return this.actions.get(id);
  }

  listActions(): ActionDefinition[] {
    return Array.from(this.actions.values());
  }

  /**
   * Returns all actions exposed as LLM agent tools.
   */
  getLlmTools(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return Array.from(this.actions.values())
      .filter((a) => a.exposeAsTool !== false)
      .map((a) => ({
        name: a.id.replace(/\./g, "_"),
        description: `${a.name}: ${a.description}`,
        parameters: a.schema || { type: "object", properties: {} }
      }));
  }

  /**
   * Executes an action with journal logging and inverse preparation.
   */
  async execute<TInput = any, TOutput = any>(
    actionId: string,
    input: TInput,
    meta: ActionMeta = {}
  ): Promise<TOutput> {
    const action = this.actions.get(actionId);
    if (!action) {
      throw new Error(`Unknown action: ${actionId}`);
    }

    const result = await action.execute(input, meta);
    const now = Date.now();

    const journalEntry: ActionExecutionJournalEntry = {
      actionId,
      input,
      result,
      meta,
      timestamp: now
    };
    this.journal.push(journalEntry);

    if (this.sql) {
      try {
        const id = `act_${crypto.randomUUID()}`;
        this.sql.exec(
          `INSERT INTO action_journal (id, action_id, input, result, meta, reverted, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?)`,
          id,
          actionId,
          JSON.stringify(input),
          JSON.stringify(result),
          JSON.stringify(meta),
          now
        );
      } catch (err) {
        console.warn("Failed to persist action journal:", err);
      }
    }

    return result;
  }

  /**
   * Reverses the most recent action or a specific journal entry.
   */
  async reverseLast(): Promise<boolean> {
    const last = this.journal.pop();
    if (!last) return false;

    const action = this.actions.get(last.actionId);
    if (!action || !action.reverse) {
      throw new Error(`Action ${last.actionId} does not support reversal`);
    }

    await action.reverse(last.input, last.result, last.meta);
    return true;
  }
}

export const name = "action-engine";

export function apply(ctx: Context): void {
  const host = ctx.get("host") as { sql?: SqlExec } | undefined;
  new ActionService(ctx, host?.sql);
}
