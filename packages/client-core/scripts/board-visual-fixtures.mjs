import assert from "node:assert/strict";

export const visualVariants = ["business", "long-bilingual", "nested-dense"];
const node = (id, title, detail, kind = "service", extra = {}) => ({
  id,
  title,
  detail,
  kind,
  ...extra,
});
const edge = (from, to, label, extra = {}) => ({ from, to, label, ...extra });

// Content is independent of seeded positions, so the same manifest can be reviewed in another renderer.
export const visualCases = {
  architecture: {
    title: "Commerce platform · Order fulfilment",
    zh: "多租户订单履约平台",
    groups: [
      { id: "platform", title: "Commerce platform", kind: "system-boundary" },
      { id: "fulfilment", title: "Fulfilment services", parent: "platform" },
    ],
    nodes: [
      node("shop", "Customer storefront", "Web and mobile checkout", "frontend", {
        parent: "platform",
      }),
      node("gateway", "API gateway", "Tenant authentication · rate limits", "security", {
        parent: "platform",
      }),
      node("orders", "Order service", "Idempotent checkout · order state", "service", {
        parent: "fulfilment",
      }),
      node("payment", "Payment adapter", "Provider tokens · webhook reconciliation", "service", {
        parent: "fulfilment",
      }),
      node("inventory", "Inventory service", "Reservation TTL · stock allocation", "service", {
        parent: "fulfilment",
      }),
      node("events", "Order event stream", "Partitioned by tenant and order", "queue", {
        parent: "platform",
      }),
      node("warehouse", "Order warehouse", "Daily revenue and fulfilment metrics", "database", {
        parent: "platform",
      }),
    ],
    edges: [
      edge("shop", "gateway", "HTTPS / checkout"),
      edge("gateway", "orders", "Create order · Idempotency-Key"),
      edge("orders", "payment", "Authorize payment"),
      edge("orders", "inventory", "Reserve stock"),
      edge("payment", "events", "Payment authorized"),
      edge("inventory", "events", "Reservation confirmed"),
      edge("events", "warehouse", "Exactly-once projection"),
    ],
    mainPath: ["shop", "gateway", "orders", "payment", "events", "warehouse"],
  },
  dataflow: {
    title: "Privacy-aware analytics pipeline",
    zh: "隐私合规事件数据管道",
    nodes: [
      node("collect", "Event collector", "Receive consented application events", "source"),
      node("validate", "Schema validation", "Reject malformed and unknown versions", "process"),
      node("redact", "PII redaction", "Remove email, IP address and device IDs", "security"),
      node("aggregate", "Window aggregation", "Five-minute cohort statistics", "process"),
      node("lake", "Analytics lake", "Encrypted, partitioned Parquet objects", "database"),
      node("deadletter", "Quarantine queue", "Replay only after schema approval", "queue"),
    ],
    edges: [
      edge("collect", "validate", "Consent + schema version"),
      edge("validate", "redact", "Valid envelope"),
      edge("validate", "deadletter", "Invalid payload"),
      edge("redact", "aggregate", "Anonymized event"),
      edge("aggregate", "lake", "Cohort metrics"),
      edge("deadletter", "validate", "Approved replay", { feedback: true }),
    ],
    mainPath: ["collect", "validate", "redact", "aggregate", "lake"],
  },
  deployment: {
    title: "Dual-region release and recovery",
    zh: "双区域发布与故障恢复",
    groups: [
      { id: "cloud", title: "Production cloud", kind: "system-boundary" },
      { id: "east", title: "Region A · primary", parent: "cloud" },
      { id: "west", title: "Region B · recovery", parent: "cloud" },
    ],
    nodes: [
      node("dns", "Global traffic manager", "Health-based routing · TTL 30s", "cloud", {
        parent: "cloud",
      }),
      node("eastapi", "Orders deployment A", "3 pods · rolling update", "service", {
        parent: "east",
      }),
      node("eastdb", "Primary database", "Synchronous local replica", "database", {
        parent: "east",
      }),
      node("westapi", "Orders deployment B", "Warm standby · autoscaling", "service", {
        parent: "west",
      }),
      node("westdb", "Recovery database", "Asynchronous cross-region replica", "database", {
        parent: "west",
      }),
      node("observability", "Release telemetry", "Error budget · rollback gates", "queue", {
        parent: "cloud",
      }),
    ],
    edges: [
      edge("dns", "eastapi", "Primary route"),
      edge("dns", "westapi", "Failover route"),
      edge("eastapi", "eastdb", "Read / write"),
      edge("westapi", "westdb", "Promoted read / write"),
      edge("eastdb", "westdb", "Encrypted replication"),
      edge("eastapi", "observability", "SLO metrics"),
      edge("westapi", "observability", "SLO metrics"),
    ],
  },
  flowchart: {
    title: "Refund request · decision and recovery",
    zh: "退款申请审批与恢复流程",
    nodes: [
      node("received", "Refund requested", "Capture order, amount and reason", "start"),
      node("eligible", "Within refund policy?", "Delivered less than 30 days ago", "decision"),
      node("risk", "High-risk payment?", "Fraud score or disputed transaction", "decision"),
      node("review", "Finance review", "Record reviewer and evidence", "process"),
      node("refund", "Issue refund", "Provider idempotency key required", "process"),
      node("notify", "Notify customer", "Receipt and estimated settlement date", "end"),
      node("reject", "Explain rejection", "Retain appeal and audit trail", "end"),
    ],
    edges: [
      edge("received", "eligible", "Evaluate policy"),
      edge("eligible", "risk", "Yes"),
      edge("eligible", "reject", "No"),
      edge("risk", "review", "Yes · manual approval"),
      edge("risk", "refund", "No"),
      edge("review", "refund", "Approved"),
      edge("refund", "notify", "Provider accepted"),
    ],
    mainPath: ["received", "eligible", "risk", "refund", "notify"],
  },
  "uml-activity": {
    title: "Procurement · request to receipt",
    zh: "跨部门采购申请到验收",
    lanes: [
      { id: "requester", title: "Requesting team" },
      { id: "finance", title: "Finance and procurement" },
      { id: "warehouse", title: "Receiving team" },
    ],
    nodes: [
      node(
        "request",
        "Submit purchase request",
        "Business justification and cost centre",
        "process",
        { lane: "requester" },
      ),
      node("budget", "Check available budget", "Reserve approved spending limit", "decision", {
        lane: "finance",
      }),
      node(
        "approve",
        "Approve supplier order",
        "Dual control for high-value purchases",
        "process",
        { lane: "finance" },
      ),
      node("receive", "Inspect delivery", "Quantity, damage and serial numbers", "process", {
        lane: "warehouse",
      }),
      node("record", "Record goods receipt", "Match purchase order and invoice", "process", {
        lane: "warehouse",
      }),
      node("close", "Confirm fulfilment", "Requester accepts delivered goods", "process", {
        lane: "requester",
      }),
    ],
    edges: [
      edge("request", "budget", "Purchase requisition"),
      edge("budget", "approve", "Budget available"),
      edge("approve", "receive", "Supplier delivery"),
      edge("receive", "record", "Inspection passed"),
      edge("record", "close", "Receipt posted"),
    ],
    mainPath: ["request", "budget", "approve", "receive", "record", "close"],
  },
  "uml-state": {
    title: "Subscription lifecycle",
    zh: "订阅计费状态生命周期",
    groups: [
      { id: "subscription", title: "Subscription aggregate", kind: "system-boundary" },
      { id: "paying", title: "Billable states", parent: "subscription" },
    ],
    nodes: [
      node("initial", "", "", "initial", { parent: "subscription" }),
      node("trial", "Trial", "entry / start trial clock", "state", { parent: "subscription" }),
      node("active", "Active", "entry / provision entitlements", "state", { parent: "paying" }),
      node("pastdue", "Past due", "do / retry payment with backoff", "state", { parent: "paying" }),
      node("suspended", "Suspended", "entry / revoke paid capabilities", "state", {
        parent: "subscription",
      }),
      node("cancelled", "Cancelled", "exit / retain billing history", "state", {
        parent: "subscription",
      }),
      node("final", "", "", "final", { parent: "subscription" }),
    ],
    edges: [
      edge("initial", "trial", "created"),
      edge("trial", "active", "paymentSucceeded"),
      edge("active", "pastdue", "renewalFailed"),
      edge("pastdue", "active", "paymentRecovered", { feedback: true }),
      edge("pastdue", "suspended", "retryWindowExpired"),
      edge("suspended", "cancelled", "cancelRequested"),
      edge("cancelled", "final", "retentionComplete"),
    ],
  },
  "uml-sequence": {
    title: "Payment API · idempotent retry",
    zh: "支付接口幂等重试时序",
    nodes: [
      node("client", "Checkout client", "Browser / mobile application"),
      node("api", "Payment API", "Idempotency boundary"),
      node("provider", "Payment provider", "External authorization"),
      node("ledger", "Payment ledger", "Durable result and outbox"),
    ],
    edges: [
      edge("client", "api", "POST /payments · Idempotency-Key"),
      edge("api", "ledger", "claim(key, requestHash)"),
      edge("api", "provider", "authorize(token, amount)"),
      edge("provider", "api", "authorization accepted", { reply: true }),
      edge("api", "ledger", "commit(result, outboxEvent)"),
      edge("api", "client", "201 paymentId + result", { reply: true }),
      edge("client", "api", "retry same key after timeout"),
      edge("api", "client", "same persisted result", { reply: true }),
    ],
  },
  "uml-class": {
    title: "Order fulfilment · domain model",
    zh: "订单履约领域类模型",
    nodes: [
      node("order", "Order", "+ id: UUID\n+ total: Money\n+ confirm(): void", "class"),
      node("line", "OrderLine", "+ sku: SKU\n+ quantity: int\n+ subtotal(): Money", "class"),
      node(
        "payment",
        "Payment",
        "+ providerRef: string\n+ status: PaymentStatus\n+ authorize(): Result",
        "class",
      ),
      node(
        "shipment",
        "Shipment",
        "+ trackingCode: string\n+ dispatchedAt: Instant\n+ dispatch(): void",
        "class",
      ),
      node(
        "address",
        "DeliveryAddress",
        "+ recipient: string\n+ postalCode: string\n+ validate(): boolean",
        "class",
      ),
    ],
    edges: [
      edge("order", "line", "items", {
        relation: "composition",
        startMultiplicity: "1",
        endMultiplicity: "1..*",
      }),
      edge("order", "payment", "settled by", {
        relation: "association",
        startMultiplicity: "1",
        endMultiplicity: "0..*",
      }),
      edge("order", "shipment", "fulfilled by", {
        relation: "aggregation",
        startMultiplicity: "1",
        endMultiplicity: "0..*",
      }),
      edge("shipment", "address", "destination", {
        relation: "association",
        startMultiplicity: "*",
        endMultiplicity: "1",
      }),
    ],
  },
  erd: {
    title: "Retail · orders and stock reservations",
    zh: "零售订单与库存预留数据模型",
    nodes: [
      node(
        "customer",
        "customers",
        "customer_id UUID PK\nemail VARCHAR UNIQUE\ncreated_at TIMESTAMP",
        "entity",
      ),
      node("order", "orders", "order_id UUID PK\ncustomer_id UUID FK\nstatus VARCHAR", "entity"),
      node("item", "order_items", "item_id UUID PK\norder_id UUID FK\nsku_id UUID FK", "entity"),
      node(
        "sku",
        "stock_keeping_units",
        "sku_id UUID PK\navailable_qty INTEGER\nwarehouse_id UUID FK",
        "entity",
      ),
      node(
        "reservation",
        "stock_reservations",
        "reservation_id UUID PK\nitem_id UUID FK\nexpires_at TIMESTAMP",
        "entity",
      ),
    ],
    edges: [
      edge("customer", "order", "places", { cardinality: "zeroOrMany" }),
      edge("order", "item", "contains", { cardinality: "oneOrMany" }),
      edge("sku", "item", "identifies", { cardinality: "zeroOrMany" }),
      edge("item", "reservation", "reserves", { cardinality: "zeroOrOne" }),
    ],
  },
  "uml-use-case": {
    title: "Outpatient appointment system",
    zh: "门诊预约系统用例",
    groups: [{ id: "clinic", title: "Appointment system", kind: "system-boundary" }],
    nodes: [
      node("patient", "Patient", "", "actor"),
      node("staff", "Clinic coordinator", "", "actor"),
      node("book", "Book appointment", "", "usecase", { parent: "clinic" }),
      node("availability", "Check clinician availability", "", "usecase", { parent: "clinic" }),
      node("identity", "Verify patient identity", "", "usecase", { parent: "clinic" }),
      node("reschedule", "Reschedule appointment", "", "usecase", { parent: "clinic" }),
      node("remind", "Send accessible reminder", "", "usecase", { parent: "clinic" }),
    ],
    edges: [
      edge("patient", "book", "", { association: true }),
      edge("staff", "reschedule", "", { association: true }),
      edge("book", "availability", "«include»"),
      edge("book", "identity", "«include»"),
      edge("reschedule", "availability", "«include»"),
      edge("remind", "book", "«extend» · reminders enabled"),
    ],
  },
  "uml-component": {
    title: "Identity and access · component contract",
    zh: "身份与访问组件契约",
    nodes: [
      node("portal", "Access portal", "Account and consent interface", "component"),
      node("identity", "Identity service", "OIDC · token issuance", "component"),
      node("policy", "Policy engine", "RBAC + contextual decisions", "component"),
      node("directory", "User directory", "Profiles · groups · lifecycle", "component"),
      node("audit", "Audit exporter", "Append-only compliance evidence", "component"),
    ],
    edges: [
      edge("portal", "identity", "OIDC authorization"),
      edge("identity", "directory", "Directory lookup"),
      edge("identity", "policy", "Authorize scope"),
      edge("policy", "audit", "Decision event"),
      edge("directory", "audit", "Identity change"),
    ],
  },
  "uml-package": {
    title: "Commerce monorepo · package boundaries",
    zh: "商城代码库包依赖边界",
    groups: [
      { id: "commerce", title: "commerce", kind: "uml-package" },
      { id: "domain", title: "domain", kind: "uml-package", parent: "commerce" },
      { id: "adapters", title: "adapters", kind: "uml-package", parent: "commerce" },
    ],
    nodes: [
      node("web", "checkout-web", "UI composition and accessibility", "package", {
        parent: "commerce",
      }),
      node("application", "order-application", "Use cases and transaction boundary", "package", {
        parent: "commerce",
      }),
      node("model", "order-domain", "Entities, value objects, policies", "package", {
        parent: "domain",
      }),
      node("contracts", "public-contracts", "Versioned commands and events", "package", {
        parent: "domain",
      }),
      node("postgres", "postgres-adapter", "Repository implementation", "package", {
        parent: "adapters",
      }),
      node("payment", "payment-adapter", "Provider protocol translation", "package", {
        parent: "adapters",
      }),
    ],
    edges: [
      edge("web", "application", "«import»"),
      edge("application", "model", "«access»"),
      edge("application", "contracts", "«import»"),
      edge("postgres", "model", "«access»"),
      edge("payment", "contracts", "«import»"),
    ],
  },
  mindmap: {
    title: "Quarterly product strategy",
    zh: "季度产品规划思维导图",
    native: true,
    nodes: [
      node("root", "Customer trust", "Product strategy"),
      node("onboarding", "Accessible onboarding", "Keyboard and screen-reader flows", "branch", {
        parent: "root",
      }),
      node("security", "Security foundations", "Passkeys and least privilege", "branch", {
        parent: "root",
      }),
      node("reliability", "Operational reliability", "Recovery and observability", "branch", {
        parent: "root",
      }),
      node("measure", "Measure activation", "Time to first shared document", "leaf", {
        parent: "onboarding",
      }),
      node("audit", "Audit permissions", "Quarterly access review", "leaf", { parent: "security" }),
      node("restore", "Practice restore", "Recovery time objective under 30m", "leaf", {
        parent: "reliability",
      }),
    ],
    edges: [],
  },
  tree: {
    title: "Regional service organization",
    zh: "区域服务团队组织树",
    native: true,
    nodes: [
      node("root", "Customer operations", "Service leadership"),
      node("apac", "Asia Pacific", "Mandarin · Japanese · English", "branch", { parent: "root" }),
      node("emea", "Europe and Africa", "Regional coverage and escalation", "branch", {
        parent: "root",
      }),
      node("americas", "Americas", "Follow-the-sun ownership", "branch", { parent: "root" }),
      node("support", "Technical support", "Incident triage and diagnosis", "leaf", {
        parent: "apac",
      }),
      node("success", "Customer success", "Adoption and renewal planning", "leaf", {
        parent: "emea",
      }),
      node("response", "Incident response", "Major incident communications", "leaf", {
        parent: "americas",
      }),
    ],
    edges: [],
  },
  timeline: {
    title: "Release readiness · 2027 Q1",
    zh: "季度产品发布里程碑",
    native: true,
    nodes: [
      node("root", "2027 Q1 release", "Release train"),
      node("design", "Jan 08 · Design reviewed", "Accessibility and threat modelling", "branch", {
        parent: "root",
      }),
      node("preview", "Jan 22 · Private preview", "Tenant migration rehearsal", "branch", {
        parent: "root",
      }),
      node(
        "candidate",
        "Feb 12 · Release candidate",
        "Load, restore and rollback drills",
        "branch",
        { parent: "root" },
      ),
      node(
        "general",
        "Mar 05 · General availability",
        "SLO and support ownership accepted",
        "branch",
        { parent: "root" },
      ),
      node("signoff", "Security sign-off", "No unresolved high-severity findings", "leaf", {
        parent: "candidate",
      }),
      node("review", "Post-release review", "Usage, incidents and follow-up actions", "leaf", {
        parent: "general",
      }),
    ],
    edges: [],
  },
};

export function getVisualCase(profile, variant) {
  assert.ok(visualCases[profile], `Unknown visual profile: ${profile}`);
  assert.ok(visualVariants.includes(variant), `Unknown visual variant: ${variant}`);
  const value = structuredClone(visualCases[profile]);
  value.profile = profile;
  value.variant = variant;
  value.direction = variant === "nested-dense" ? "vertical" : "horizontal";
  if (variant === "long-bilingual") {
    value.title = `${value.zh} / ${value.title}`;
    const requirement = {
      architecture:
        "跨租户请求必须携带幂等键；订单状态、库存预留与支付回调通过可重放事件一致收敛。",
      dataflow: "仅处理已同意采集的事件；敏感字段在落盘前去标识化，隔离数据须经审批后重放。",
      deployment: "主区域不可用时由健康检查触发切换；恢复后先核对复制位置和未完成事务。",
      flowchart: "超过政策期限须说明拒绝原因；高风险交易由财务复核并保留证据和申诉入口。",
      "uml-activity": "采购申请、预算审批和收货验收分别由责任团队完成；所有交接保留业务单据。",
      "uml-state": "续费失败进入可恢复的重试窗口；暂停与取消分别处理授权回收和账单历史保留。",
      "uml-sequence": "客户端超时重试必须返回同一持久化结果；同键不同请求内容应明确拒绝。",
      "uml-class": "业务字段和操作属于原始领域模型；金额、库存数量及生命周期约束不能在布局中丢失。",
      erd: "外键、唯一性与可选基数保持数据库语义；库存预留过期不能删除订单历史。",
      "uml-use-case": "患者和门诊协调员的权限不同；身份核验、可用号源与无障碍提醒均保留独立用例。",
      "uml-component": "令牌签发、目录读取、策略决策和审计导出遵守清晰组件边界及最小权限。",
      "uml-package": "领域模型不能依赖持久化和支付实现；适配器通过公开契约实现依赖倒置。",
      mindmap: "每项产品目标包含责任人、可衡量验收标准，以及跨团队依赖的升级路径。",
      tree: "区域团队保留语言、时区与升级责任；跨区域移交必须可追踪到接手团队。",
      timeline: "发布时间点由安全审查、迁移演练与回滚验收共同约束；未通过门禁不得推进。",
    }[profile];
    for (const item of value.nodes) {
      if (["initial", "final"].includes(item.kind)) continue;
      item.detail = `${item.detail}${item.detail ? "\n" : ""}${requirement}`;
    }
  }
  if (variant === "nested-dense") {
    if (profile === "uml-sequence")
      value.edges.push(
        edge("provider", "api", "webhook · duplicate authorization event"),
        edge("api", "ledger", "deduplicate providerEventId"),
        edge("ledger", "api", "existing committed result", { reply: true }),
        edge("api", "provider", "200 acknowledged", { reply: true }),
      );
    if (profile === "uml-class") {
      value.nodes.push(
        node(
          "reservation",
          "StockReservation",
          "+ expiresAt: Instant\n+ quantity: int\n+ release(): void",
          "class",
        ),
      );
      value.edges.push(
        edge("line", "reservation", "allocated stock", {
          relation: "composition",
          startMultiplicity: "1",
          endMultiplicity: "0..*",
        }),
      );
    }
    if (profile === "erd") {
      value.nodes.push(
        node(
          "warehouse",
          "warehouses",
          "warehouse_id UUID PK\nregion_code VARCHAR\nname VARCHAR",
          "entity",
        ),
      );
      value.edges.push(edge("warehouse", "sku", "stores", { cardinality: "zeroOrMany" }));
    }
    if (profile === "uml-use-case") {
      value.nodes.push(
        node("preferences", "Manage reminder preferences", "", "usecase", { parent: "clinic" }),
      );
      value.edges.push(
        edge("patient", "preferences", "", { association: true }),
        edge("remind", "preferences", "«include»"),
      );
    }
    if (profile === "uml-activity") {
      value.nodes.push(
        node(
          "revise",
          "Revise purchase request",
          "Explain budget gap and propose alternatives",
          "process",
          { lane: "requester" },
        ),
      );
      value.edges.push(
        edge("budget", "revise", "Budget unavailable"),
        edge("revise", "request", "Re-submit with revised scope", { feedback: true }),
      );
    }
    if (value.native) {
      const branches = value.nodes.filter((item) => item.parent === "root");
      for (const branch of branches) {
        value.nodes.push(
          node(
            `${branch.id}-owner`,
            `${branch.title} · ownership`,
            "Accountable team and measurable acceptance",
            "leaf",
            { parent: branch.id },
          ),
        );
        value.nodes.push(
          node(
            `${branch.id}-risk`,
            `${branch.title} · dependency risk`,
            "Escalate unresolved cross-team dependencies",
            "leaf",
            { parent: `${branch.id}-owner` },
          ),
        );
      }
    } else if (
      profile !== "uml-sequence" &&
      !["uml-class", "erd", "uml-use-case"].includes(profile)
    ) {
      value.groups ??= [];
      if (!value.groups.length && !value.lanes)
        value.groups.push({ id: "business-domain", title: value.zh, kind: "system-boundary" });
      if (value.groups.length && !value.lanes) {
        const root = value.groups.find((group) => !group.parent);
        const nested = {
          id: "operational-boundary",
          title: "Operational ownership / 运行责任边界",
          parent: root.id,
        };
        value.groups.push(nested);
        for (const item of value.nodes.filter((item) => !item.parent)) item.parent = nested.id;
      }
    }
  }
  return value;
}

function json(value) {
  return JSON.parse(JSON.stringify(value));
}

export function realizeVisualFixture(board, api, profile, variant) {
  const spec = getVisualCase(profile, variant);
  const E = api.Enum;
  const ids = {};
  const protectedIds = [];
  const fixed = [];
  const groups = {};
  const expectations = [];
  const structuredTableText = new Map();
  const ensure = (value, reason) => {
    assert.ok(value, reason);
    return value;
  };
  const rich = (title, detail, color = "#243247") => {
    const text = api
      .newRichText()
      .align({ horizontal: E.HorizontalAlign.CENTER, vertical: E.VerticalAlign.MIDDLE });
    text
      .paragraph({ lineHeight: 1.2, spaceAfter: 3 })
      .span(title, { fontFamily: "Arial", fontSize: 11.25, color, bold: true });
    if (detail)
      for (const paragraph of detail.split("\n")) {
        text
          .paragraph({ lineHeight: 1.25, spaceAfter: 0 })
          .span(paragraph, { fontFamily: "Arial", fontSize: 9, color: "#475569", bold: false });
      }
    return text;
  };
  const size = (item) => {
    if (["initial", "final"].includes(item.kind)) return { width: 28, height: 28 };
    if (item.kind === "actor") return { width: 130, height: 128 };
    const width = variant === "long-bilingual" ? 310 : item.kind === "decision" ? 256 : 218;
    const lines = item.detail
      .split("\n")
      .reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length * 7) / (width - 28))), 0);
    return { width, height: Math.max(item.kind === "decision" ? 138 : 84, 44 + lines * 19) };
  };
  const seed = (index, item) => ({
    left: 130 + (index % 3) * 57,
    top: 150 + (index % 4) * 43,
    ...size(item),
  });
  if (spec.native) {
    const children = (id) =>
      spec.nodes
        .filter((item) => item.parent === id)
        .map((item) => ({
          text: [item.title, item.detail].filter(Boolean).join("\n"),
          children: children(item.id),
        }));
    const root = spec.nodes.find((item) => !item.parent);
    ensure(
      board.insertMindMap({
        left: 520,
        top: 400,
        structureKind: {
          mindmap: variant === "nested-dense" ? "mindmap-vertical" : "mindmap-horizontal",
          tree: variant === "nested-dense" ? "tree-down" : "tree-right",
          timeline: variant === "nested-dense" ? "timeline-vertical" : "timeline-horizontal",
        }[profile],
        root: {
          text: [root.title, root.detail].filter(Boolean).join("\n"),
          children: children(root.id),
        },
      }),
      "Native structure insertion failed",
    );
    protectedIds.push(...Object.keys(board.getElements()));
  } else if (profile === "uml-sequence") {
    spec.nodes.forEach((item, index) => {
      const ref = ensure(
        board.insertShape({
          shapeType: E.BoardSequenceShapeType.ObjectLifeline,
          transform: {
            left: 100 + index * 390,
            top: 80,
            width: 290,
            height: variant === "long-bilingual" ? 150 : 85,
          },
          shapeData: {
            sequenceLifeline: {
              participantShapeType: "object",
              participantEngineShapeType: E.ShapeTypeEnum.RoundRect,
              lifelineHeight: spec.edges.length * 140 + 220,
              minLifelineHeight: 80,
            },
          },
        }),
        "Sequence participant insertion failed",
      );
      ref.getText().setRichText(rich(item.title, item.detail));
      ids[item.id] = ref.getId();
    });
    ensure(
      board.insertSequenceMessages(
        spec.edges.map((item, index) => ({
          fromParticipantId: ids[item.from],
          toParticipantId: ids[item.to],
          type: item.reply ? "reply" : "synchronous",
          text: item.label,
          order: index + 1,
        })),
        { timeOriginY: variant === "long-bilingual" ? 270 : 210, step: 140 },
      ),
      "Sequence message insertion failed",
    );
    protectedIds.push(...Object.keys(board.getElements()));
  } else {
    for (const group of spec.groups ?? []) {
      const id = `visual-${group.id}`;
      ensure(
        board.createContainer({
          id,
          title: group.title,
          kind: group.kind ?? "generic",
          ...(group.parent ? { parentId: groups[group.parent] } : {}),
          left: group.parent ? 32 : 72,
          top: 78,
          width: 640,
          height: 360,
          fillColor: group.parent ? "#f8fafc" : "#ffffff",
          strokeColor: "#94a3b8",
          strokeWidth: 1,
          custom: { visualSourceId: group.id },
        }),
        `Cannot create ${group.id}`,
      );
      const created = board.getElement(id);
      ensure(
        board.updateElement(id, {
          element: {
            ...created,
            containerData: {
              ...created.containerData,
              headerSize: 0,
              behavior: { ...created.containerData.behavior, layoutOccupancy: "frame" },
            },
          },
        }),
        "External caption configuration failed",
      );
      ensure(
        board.setContainerStyle(id, {
          titleStyle: { fontFamily: "Arial", fontSize: 16, bold: true, color: "#334155" },
        }),
        "Container title styling failed",
      );
      groups[group.id] = id;
    }
    if (spec.lanes) {
      const dimensions = spec.nodes.map(size);
      const poolWidth =
        190 +
        64 +
        (spec.direction === "horizontal"
          ? dimensions.reduce((sum, value) => sum + value.width, 0) + (spec.nodes.length - 1) * 100
          : Math.max(
              ...spec.lanes.map((lane) => {
                const members = spec.nodes.filter((item) => item.lane === lane.id).map(size);
                return (
                  members.reduce((sum, value) => sum + value.width, 0) +
                  Math.max(0, members.length - 1) * 48
                );
              }),
            ));
      const lanes = spec.lanes.map((lane) => {
        const members = spec.nodes.filter((item) => item.lane === lane.id).map(size);
        return {
          ...lane,
          size: Math.max(
            230,
            members.reduce((sum, value) => sum + value.height, 0) +
              Math.max(0, members.length - 1) * (spec.direction === "vertical" ? 100 : 48) +
              72,
          ),
        };
      });
      ensure(
        board.createSwimlane({
          id: "visual-pool",
          left: 70,
          top: 90,
          width: poolWidth,
          height: lanes.reduce((sum, lane) => sum + lane.size, 0) + 80,
          headerSize: 190,
          title: spec.title,
          orientation: "horizontal",
          lanes,
        }),
        "Swimlane insertion failed",
      );
      protectedIds.push("visual-pool");
    }
    spec.nodes.forEach((item, index) => {
      if (["uml-class", "erd"].includes(profile)) {
        const table = ensure(
          board.insertTable({
            left: seed(index, item).left,
            top: seed(index, item).top,
            diagramPreset:
              profile === "uml-class"
                ? E.BoardTableDiagramPreset.UMLClass
                : E.BoardTableDiagramPreset.ERDFull,
          }),
          "Diagram table insertion failed",
        );
        const lines = item.detail.split("\n");
        const rows =
          profile === "uml-class"
            ? [
                [item.title],
                [lines.filter((line) => /^[-+#~]\s/.test(line) && !line.includes("(")).join("\n")],
                [lines.filter((line) => /^[-+#~]\s/.test(line) && line.includes("(")).join("\n")],
                ...lines.filter((line) => !/^[-+#~]\s/.test(line)).map((line) => [line]),
              ]
            : [
                [item.title, "", ""],
                ...lines.map((line) => {
                  const field = /^([A-Za-z_]\w*)\s+([A-Z][A-Z0-9()]*)\s*(PK|FK|UNIQUE)?$/.exec(
                    line,
                  );
                  return field ? [field[3] ?? "", field[1], field[2]] : [line, "", ""];
                }),
              ];
        const styles = [0, 1].map((row) => {
          const doc = table.getCellRichText(row, 0).getData();
          return json(doc.body?.textRuns?.[0]?.ts ?? doc.documentStyle.textStyle);
        });
        const requiredRows = rows.length;
        const existingRows = table.getValues().length;
        if (existingRows < requiredRows)
          ensure(
            table.insertRows(existingRows, requiredRows - existingRows),
            "Cannot retain every compartment row",
          );
        const columns = table.getStructure().columnCount;
        for (let row = 0; row < table.getValues().length; row++) {
          for (let column = 0; column < columns; column++) {
            const text = api.newRichText().align({
              horizontal: row === 0 ? E.HorizontalAlign.CENTER : E.HorizontalAlign.LEFT,
              vertical: E.VerticalAlign.MIDDLE,
            });
            for (const paragraph of (rows[row]?.[column] ?? "").split("\n"))
              text
                .paragraph({ lineHeight: 1.2, spaceAfter: 0 })
                .span(paragraph, styles[row === 0 ? 0 : 1]);
            ensure(table.setCellRichText(row, column, text), "Cannot retain styled table text");
          }
          if (profile === "erd" && row > 0 && rows[row]?.[0] && !rows[row]?.[1])
            ensure(
              table.mergeCells({ startRow: row, endRow: row, startColumn: 0, endColumn: 2 }),
              "Cannot retain entity note",
            );
          if (
            row > 0 &&
            (rows[row]?.[0]?.includes("\n") ||
              (profile === "erd" && !rows[row]?.[1]) ||
              (profile === "uml-class" && row >= 3))
          )
            ensure(table.resizeRows(row, row, 88), "Cannot seed a readable multiline compartment");
        }
        ids[item.id] = table.getId();
        structuredTableText.set(
          item.id,
          rows
            .flat()
            .flatMap((text) => text.split("\n"))
            .filter(Boolean),
        );
        const values = json(table.getValues());
        expectations.push(() =>
          assert.deepEqual(table.getValues(), values, "Table compartments changed"),
        );
        return;
      }
      const shapeType =
        {
          decision: E.ShapeTypeEnum.FlowchartDecision,
          start: E.ShapeTypeEnum.FlowchartTerminator,
          end: E.ShapeTypeEnum.FlowchartTerminator,
          process: E.ShapeTypeEnum.FlowchartProcess,
          database: E.BoardCustomShapeType.DataStorage1,
          queue: E.ShapeTypeEnum.RoundRect,
          actor: E.BoardCustomShapeType.Actor,
          usecase: E.ShapeTypeEnum.Ellipse,
          component: E.BoardCustomShapeType.ComponentBox,
          initial: E.BoardCustomShapeType.InitialState,
          final: E.BoardCustomShapeType.FinalState,
        }[item.kind] ?? E.ShapeTypeEnum.RoundRect;
      const palette = {
        security: ["#fff1f2", "#be185d"],
        database: ["#f5f3ff", "#7c3aed"],
        queue: ["#fff7ed", "#c2410c"],
        cloud: ["#fffbeb", "#b45309"],
        frontend: ["#eff6ff", "#2563eb"],
      }[item.kind] ?? ["#f0fdfa", "#0f766e"];
      const transform = seed(index, item);
      const point = item.lane
        ? {
            x: 310 + index * 70,
            y:
              210 +
              board
                .getElement("visual-pool")
                .containerData.swimlane.lanes.slice(
                  0,
                  spec.lanes.findIndex((lane) => lane.id === item.lane),
                )
                .reduce((sum, lane) => sum + lane.size, 0),
          }
        : { x: transform.left, y: transform.top };
      const ref = ensure(
        board.insertShapeAtPoint({
          id: `visual-${item.id}`,
          shapeType,
          point,
          width: transform.width,
          height: transform.height,
          text: rich(item.title, item.detail),
          textBox: {
            padding: { left: 12, right: 12, top: 10, bottom: 10 },
            textWrap: E.ShapeTextWrapType.Square,
            autoFitType: E.ShapeTextAutoFitType.NoAutoFit,
          },
          fillColor: palette[0],
          strokeColor: palette[1],
          strokeWidth: 1.25,
          attachToDropTarget: false,
          ...(item.parent ? { parentId: groups[item.parent] } : {}),
          ...(item.lane ? { parentId: "visual-pool", laneId: item.lane } : {}),
          custom: { visualSourceId: item.id, semanticKind: item.kind },
        }),
        `Cannot create ${item.id}`,
      );
      ids[item.id] = ref.id;
    });
    for (const item of spec.edges) {
      let ref;
      if (profile === "uml-class")
        ref = board.insertClassRelation({
          type: item.relation,
          start: {
            elementId: ids[item.from],
            role: item.from,
            multiplicity: item.startMultiplicity,
          },
          end: { elementId: ids[item.to], role: item.label, multiplicity: item.endMultiplicity },
          name: item.label,
        });
      else if (profile === "erd")
        ref = board.insertEntityRelation({
          type: "nonIdentifying",
          start: { elementId: ids[item.from], cardinality: "one" },
          end: { elementId: ids[item.to], cardinality: item.cardinality },
          label: item.label,
        });
      else {
        const primary = spec.mainPath?.some(
          (id, index) => id === item.from && spec.mainPath[index + 1] === item.to,
        );
        ref = board.insertConnector({
          fromElementId: ids[item.from],
          toElementId: ids[item.to],
          labelText: item.label,
          routing: "orthogonal",
          routingMode: "auto",
          style: {
            stroke: primary ? "#0369a1" : "#64748b",
            strokeWidth: primary ? 2 : 1.25,
            endMarker: {
              type: item.association
                ? "none"
                : profile === "uml-use-case" || profile === "uml-package"
                  ? "openArrow"
                  : "filledArrow",
            },
            ...(["uml-use-case", "uml-package"].includes(profile) && !item.association
              ? { dash: [6, 4] }
              : {}),
          },
          custom: { visualSource: item, mainPath: !!primary },
        });
      }
      ensure(ref, `Cannot create ${item.from} → ${item.to}`);
    }
  }
  // Fit generated seed frames before graph spacing; authored oversized frames would otherwise dictate the layout span.
  for (const id of Object.values(groups).reverse())
    ensure(board.fitContainerToContent(id), "Generated seed frame fit failed");
  const layoutElementIds = Object.keys(board.getElements());
  const heading = ensure(
    board.insertText({
      id: "visual-case-heading",
      left: 70,
      top: -60,
      width: variant === "long-bilingual" ? 1500 : 1100,
      height: 110,
      text: api
        .newRichText()
        .paragraph({ lineHeight: 1.2, spaceAfter: 5 })
        .span(spec.title, { fontFamily: "Arial", fontSize: 18, bold: true, color: "#0f172a" })
        .paragraph({ lineHeight: 1.25, spaceAfter: 0 })
        .span(`${profile} · ${variant}`, {
          fontFamily: "Consolas",
          fontSize: 9,
          bold: false,
          color: "#64748b",
        }),
    }),
    "Business heading insertion failed",
  );
  fixed.push(heading.id);
  const contentBefore = json(board.getElements());
  const expectedRelations = spec.native ? spec.nodes.length - 1 : spec.edges.length;
  const nodes = Object.values(ids);
  return {
    spec,
    nodes,
    fixed,
    protected: protectedIds,
    layoutOptions: {
      elementIds: layoutElementIds,
      direction: spec.direction,
      maxNodes: 180,
      ...(profile === "uml-class" ? { layerGap: 160 } : {}),
    },
    compactContainers: Object.values(groups).reverse(),
    semanticCoverage: {
      source: "business-content",
      profile,
      variant,
      title: spec.title,
      nodes: spec.nodes.length,
      relations: expectedRelations,
      sourceManifest: spec,
      primitiveTypes: [...new Set(Object.values(contentBefore).map((item) => item.type))],
      nativeOwnership: spec.native || profile === "uml-sequence",
      visualScopeElementIds: Object.values(groups),
    },
    verify() {
      const elements = Object.values(board.getElements());
      assert.equal(
        elements.filter((item) => item.type === "connector").length,
        expectedRelations,
        "Business relationships lost",
      );
      for (const id of Object.values(groups))
        assert.equal(
          board.getElement(id).containerData.behavior.layoutOccupancy,
          "frame",
          "Generated visual scope occupancy changed",
        );
      for (const item of spec.nodes) {
        if (!ids[item.id]) continue;
        const actual = board.getElement(ids[item.id]);
        if (item.parent && !spec.native)
          assert.equal(
            actual.parentId,
            groups[item.parent],
            "Business container ownership changed",
          );
        if (item.lane) {
          assert.equal(actual.parentId, "visual-pool");
          assert.equal(actual.laneId, item.lane);
        }
      }
      expectations.forEach((check) => check());
      const encoded = JSON.stringify(board.save());
      for (const item of spec.nodes)
        for (const fragment of structuredTableText.get(item.id) ??
          [item.title, ...item.detail.split("\n")].filter(Boolean)) {
          assert.ok(
            encoded.includes(JSON.stringify(fragment).slice(1, -1)),
            `Business text lost: ${item.id}`,
          );
        }
    },
    verifyLayout() {},
  };
}
