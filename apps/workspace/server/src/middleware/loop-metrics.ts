import client from "prom-client";
import { logger } from "../logging/logger.js";

const owners = ["human", "agent_claimed", "agent_unclaimed"] as const;

/**
 * The growth loop: a file is shared, its page is opened, and a reader signs up or connects an agent.
 * Each event is one counter with low-cardinality labels and one log line with the IDs to drill down by.
 */
const loopEvents = {
  "workspace.link_sharing": {
    metric: "workspace_link_sharing_changes_total",
    help: "Link Sharing turned on or off",
    labels: { state: ["on", "off"], role: ["viewer", "editor"], owner_category: owners },
    fields: ["node_id", "user_id"],
  },
  "workspace.share_page": {
    metric: "workspace_share_page_views_total",
    help: "Shared file pages served",
    labels: { session: ["signed_in", "signed_out"], owner_category: owners },
    fields: ["node_id", "user_agent"],
  },
  "workspace.signup": {
    metric: "workspace_signups_total",
    help: "Accounts created by sign-up",
    labels: {
      method: ["password", "email", "github", "google", "discord", "discord_bot"],
      source: ["share_link", "claim_link", "oauth_consent", "direct"],
    },
    fields: ["user_id", "node_id"],
  },
  "workspace.guest_agent": {
    metric: "workspace_guest_agents_created_total",
    help: "Guest agents created",
    labels: { entry: ["api_agents", "auth_guest", "auth_token"] },
    fields: ["user_id"],
  },
} as const;

type LoopEvents = typeof loopEvents;
type LoopEvent = keyof LoopEvents;
type Labels<E extends LoopEvent> = {
  readonly [L in keyof LoopEvents[E]["labels"]]: LoopEvents[E]["labels"][L] extends readonly (infer V)[] ? V : never;
};
type Fields<E extends LoopEvent> = Readonly<Record<LoopEvents[E]["fields"][number], string | null>>;
type SignupMethod = Labels<"workspace.signup">["method"];

const counters = Object.fromEntries(
  Object.entries(loopEvents).map(([event, { metric, help, labels }]) => {
    const counter = new client.Counter({ name: metric, help, labelNames: Object.keys(labels) });
    // A series that starts at zero lets increase() count the first event after a restart.
    const series = Object.entries<readonly string[]>(labels).reduce<Record<string, string>[]>(
      (rows, [name, values]) => rows.flatMap((row) => values.map((value) => ({ ...row, [name]: value }))),
      [{}]
    );
    for (const labelValues of series) counter.inc(labelValues, 0);
    return [event, counter];
  })
) as Record<LoopEvent, client.Counter>;

export function recordLoopEvent<E extends LoopEvent>(event: E, labels: Labels<E>, fields: Fields<E>): void {
  counters[event].inc(labels);
  logger.info({ event, schema_version: 1, ts: new Date().toISOString(), ...labels, ...fields });
}

const signupSources = [
  ["/nodes/", "share_link"],
  ["/claim/", "claim_link"],
  ["/api/auth/authorize", "oauth_consent"],
] as const;

export function recordSignup(method: SignupMethod, userId: string, returnTo: string | undefined): void {
  const source = signupSources.find(([path]) => returnTo?.startsWith(path))?.[1] ?? "direct";
  const nodeId = /^\/nodes\/([\w-]+)/u.exec(returnTo ?? "")?.[1] ?? null;
  recordLoopEvent("workspace.signup", { method, source }, { user_id: userId, node_id: nodeId });
}
