export type ParityOwner =
  | "add-dsh-api-resource-discovery-tools"
  | "add-dsh-bundled-unit-topic-skills"
  | "add-dsh-content-runtime-tools"
  | "add-dsh-file-transfer-tools"
  | "add-dsh-office-exchange-tools"
  | "add-dsh-render-verification-tools"
  | "add-dsh-space-node-tools"
  | "add-dsh-svg-generation-tools"
  | "add-dsh-typst-generation-tools"
  | "add-dsh-univer-work-authentication"
  | "add-dsh-univer-work-plugin-shell"
  | "add-dsh-worktree-unit-tools";

export type ParitySafetyDimension =
  | "allowlisted-failure"
  | "approval"
  | "caller-cancellation"
  | "confirmed-partial-file"
  | "non-local"
  | "owner-cancellation"
  | "result-unknown"
  | "secret-sentinel"
  | "unlisted-failure";

type CliRoute = {
  readonly path: string;
  readonly arguments?: readonly string[];
  readonly options?: readonly string[];
  readonly mechanismOptions?: readonly string[];
  readonly presentationOptions?: readonly string[];
  readonly results: readonly string[];
  readonly presentations?: readonly ("help" | "json" | "path" | "text" | "version")[];
} & (
  | { readonly kind: "outcome"; readonly outcomes: readonly string[] }
  | { readonly kind: "mechanism"; readonly mechanism: string }
  | { readonly kind: "presentation"; readonly evidence: string }
);

export const PARITY_MANIFEST = {
  baseline: {
    workspaceCommit: "a01adf28bfdfbf098ecf66653d520d08ecac4117",
    sdk: "1.0.0-beta.2",
    dsh: "0.1.1-rc.2",
    dshCommit: "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e",
  },
  cliSurfaceTotals: { commands: 67, arguments: 31, options: 158 },
  owners: [
    "add-dsh-api-resource-discovery-tools",
    "add-dsh-bundled-unit-topic-skills",
    "add-dsh-content-runtime-tools",
    "add-dsh-file-transfer-tools",
    "add-dsh-office-exchange-tools",
    "add-dsh-render-verification-tools",
    "add-dsh-space-node-tools",
    "add-dsh-svg-generation-tools",
    "add-dsh-typst-generation-tools",
    "add-dsh-univer-work-authentication",
    "add-dsh-univer-work-plugin-shell",
    "add-dsh-worktree-unit-tools",
  ] as const satisfies readonly ParityOwner[],
  acceptanceCases: [
    { id: "api-discovery.installed.native", outcome: "api-discovery", owner: "add-dsh-api-resource-discovery-tools", mode: "native" },
    { id: "api-discovery.installed.code", outcome: "api-discovery", owner: "add-dsh-api-resource-discovery-tools", mode: "code" },
    { id: "authentication.installed.native", outcome: "authentication", owner: "add-dsh-univer-work-authentication", mode: "native" },
    { id: "authentication.installed.code", outcome: "authentication", owner: "add-dsh-univer-work-authentication", mode: "code" },
    { id: "content.installed.native", outcome: "content", owner: "add-dsh-content-runtime-tools", mode: "native" },
    { id: "content.installed.code", outcome: "content", owner: "add-dsh-content-runtime-tools", mode: "code" },
    { id: "file-transfer.installed.native", outcome: "file-transfer", owner: "add-dsh-file-transfer-tools", mode: "native" },
    { id: "file-transfer.installed.code", outcome: "file-transfer", owner: "add-dsh-file-transfer-tools", mode: "code" },
    { id: "office.installed.native", outcome: "office", owner: "add-dsh-office-exchange-tools", mode: "native" },
    { id: "office.installed.code", outcome: "office", owner: "add-dsh-office-exchange-tools", mode: "code" },
    { id: "render.installed.native", outcome: "render", owner: "add-dsh-render-verification-tools", mode: "native" },
    { id: "render.installed.code", outcome: "render", owner: "add-dsh-render-verification-tools", mode: "code" },
    { id: "resource-discovery.installed.native", outcome: "resource-discovery", owner: "add-dsh-api-resource-discovery-tools", mode: "native" },
    { id: "resource-discovery.installed.code", outcome: "resource-discovery", owner: "add-dsh-api-resource-discovery-tools", mode: "code" },
    { id: "shell.installed.native", outcome: "shell", owner: "add-dsh-univer-work-plugin-shell", mode: "native" },
    { id: "shell.installed.code", outcome: "shell", owner: "add-dsh-univer-work-plugin-shell", mode: "code" },
    { id: "space-node.installed.native", outcome: "space-node", owner: "add-dsh-space-node-tools", mode: "native" },
    { id: "space-node.installed.code", outcome: "space-node", owner: "add-dsh-space-node-tools", mode: "code" },
    { id: "svg.installed.native", outcome: "svg", owner: "add-dsh-svg-generation-tools", mode: "native" },
    { id: "svg.installed.code", outcome: "svg", owner: "add-dsh-svg-generation-tools", mode: "code" },
    { id: "typst.installed.native", outcome: "typst", owner: "add-dsh-typst-generation-tools", mode: "native" },
    { id: "typst.installed.code", outcome: "typst", owner: "add-dsh-typst-generation-tools", mode: "code" },
    { id: "unit-topic-skills.installed.native", outcome: "unit-topic-skills", owner: "add-dsh-bundled-unit-topic-skills", mode: "native" },
    { id: "unit-topic-skills.installed.code", outcome: "unit-topic-skills", owner: "add-dsh-bundled-unit-topic-skills", mode: "code" },
    { id: "worktree-unit.installed.native", outcome: "worktree-unit", owner: "add-dsh-worktree-unit-tools", mode: "native" },
    { id: "worktree-unit.installed.code", outcome: "worktree-unit", owner: "add-dsh-worktree-unit-tools", mode: "code" },
  ] as const,
  outcomes: [
    {
      id: "shell",
      owner: "add-dsh-univer-work-plugin-shell",
      operations: [],
      skills: [],
      productionEntry: "src/index.ts",
      caseIds: ["shell.installed.native", "shell.installed.code"],
    },
    {
      id: "authentication",
      owner: "add-dsh-univer-work-authentication",
      operations: ["workspace_auth_start", "workspace_auth_complete", "workspace_auth_whoami", "workspace_auth_logout"],
      approval: { required: ["workspace_auth_logout"], conditional: [] },
      skills: [],
      productionEntry: "src/authentication.ts",
      caseIds: ["authentication.installed.native", "authentication.installed.code"],
    },
    {
      id: "space-node",
      owner: "add-dsh-space-node-tools",
      operations: ["workspace_space_list", "workspace_space_browse", "workspace_space_find", "workspace_node_create", "workspace_node_rename", "workspace_node_move", "workspace_node_trash"],
      approval: { required: ["workspace_node_create", "workspace_node_rename", "workspace_node_move", "workspace_node_trash"], conditional: [] },
      skills: [],
      productionEntry: "src/space-node.ts",
      caseIds: ["space-node.installed.native", "space-node.installed.code"],
    },
    {
      id: "worktree-unit",
      owner: "add-dsh-worktree-unit-tools",
      operations: ["workspace_worktree_list", "workspace_worktree_get", "workspace_worktree_create", "workspace_worktree_update", "workspace_worktree_ready", "workspace_worktree_reopen", "workspace_worktree_merge", "workspace_worktree_discard", "workspace_unit_list", "workspace_unit_add", "workspace_unit_create", "workspace_worktree_review_url"],
      approval: { required: ["workspace_worktree_create", "workspace_worktree_update", "workspace_worktree_ready", "workspace_worktree_reopen", "workspace_worktree_merge", "workspace_worktree_discard", "workspace_unit_add", "workspace_unit_create"], conditional: [] },
      skills: ["core"],
      productionEntry: "src/worktree-unit.ts",
      caseIds: ["worktree-unit.installed.native", "worktree-unit.installed.code"],
    },
    {
      id: "file-transfer",
      owner: "add-dsh-file-transfer-tools",
      operations: ["workspace_blob_upload", "workspace_blob_get", "workspace_blob_download", "workspace_asset_download"],
      approval: { required: ["workspace_blob_upload", "workspace_blob_download", "workspace_asset_download"], conditional: [] },
      skills: [],
      productionEntry: "src/file-transfer.ts",
      caseIds: ["file-transfer.installed.native", "file-transfer.installed.code"],
    },
    {
      id: "content",
      owner: "add-dsh-content-runtime-tools",
      operations: ["workspace_content_inspect", "workspace_content_execute"],
      approval: { required: ["workspace_content_execute"], conditional: [] },
      skills: [],
      productionEntry: "src/content-tools.ts",
      caseIds: ["content.installed.native", "content.installed.code"],
    },
    {
      id: "office",
      owner: "add-dsh-office-exchange-tools",
      operations: ["workspace_office_import", "workspace_office_export"],
      approval: { required: ["workspace_office_import", "workspace_office_export"], conditional: [] },
      skills: [],
      productionEntry: "src/office-tools.ts",
      caseIds: ["office.installed.native", "office.installed.code"],
    },
    {
      id: "typst",
      owner: "add-dsh-typst-generation-tools",
      operations: ["workspace_typst_compile", "workspace_typst_apply"],
      approval: { required: ["workspace_typst_compile", "workspace_typst_apply"], conditional: [] },
      skills: [],
      productionEntry: "src/typst-tools.ts",
      caseIds: ["typst.installed.native", "typst.installed.code"],
    },
    {
      id: "svg",
      owner: "add-dsh-svg-generation-tools",
      operations: ["workspace_svg_compile", "workspace_svg_apply"],
      approval: { required: ["workspace_svg_apply"], conditional: ["workspace_svg_compile"] },
      skills: [],
      productionEntry: "src/svg-tools.ts",
      caseIds: ["svg.installed.native", "svg.installed.code"],
    },
    {
      id: "render",
      owner: "add-dsh-render-verification-tools",
      operations: ["workspace_screenshot", "workspace_layout_lint"],
      approval: { required: ["workspace_screenshot"], conditional: [] },
      skills: [],
      productionEntry: "src/render-tools.ts",
      caseIds: ["render.installed.native", "render.installed.code"],
    },
    {
      id: "api-discovery",
      owner: "add-dsh-api-resource-discovery-tools",
      operations: ["workspace_api_find", "workspace_api_show"],
      approval: { required: [], conditional: [] },
      skills: [],
      productionEntry: "src/discovery-tools.ts",
      caseIds: ["api-discovery.installed.native", "api-discovery.installed.code"],
    },
    {
      id: "resource-discovery",
      owner: "add-dsh-api-resource-discovery-tools",
      operations: ["workspace_resource_registries", "workspace_resource_find", "workspace_resource_export"],
      approval: { required: ["workspace_resource_export"], conditional: [] },
      skills: [],
      productionEntry: "src/discovery-tools.ts",
      caseIds: ["resource-discovery.installed.native", "resource-discovery.installed.code"],
    },
    {
      id: "unit-topic-skills",
      owner: "add-dsh-bundled-unit-topic-skills",
      operations: [],
      skills: ["base", "board", "cross-unit-formula", "doc", "embed", "sheet", "slide"],
      productionEntry: "src/bundled-skills.ts",
      caseIds: ["unit-topic-skills.installed.native", "unit-topic-skills.installed.code"],
    },
  ] as const,
  safetyCases: [
    {
      outcome: "authentication",
      cases: [
        { id: "authentication.installed.native", dimensions: ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "result-unknown", "secret-sentinel"] },
        { id: "authentication.installed.code", dimensions: ["secret-sentinel"] },
      ],
    },
    {
      outcome: "space-node",
      cases: [
        { id: "space-node.installed.native", dimensions: ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "result-unknown", "secret-sentinel"] },
        { id: "space-node.installed.code", dimensions: ["secret-sentinel"] },
      ],
    },
    {
      outcome: "worktree-unit",
      cases: [
        { id: "worktree-unit.installed.native", dimensions: ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "result-unknown", "secret-sentinel"] },
        { id: "worktree-unit.installed.code", dimensions: ["secret-sentinel"] },
      ],
    },
    {
      outcome: "file-transfer",
      cases: [
        { id: "file-transfer.installed.native", dimensions: ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "result-unknown", "confirmed-partial-file", "secret-sentinel", "non-local"] },
        { id: "file-transfer.installed.code", dimensions: ["approval", "allowlisted-failure", "unlisted-failure", "secret-sentinel"] },
      ],
    },
    {
      outcome: "content",
      cases: [
        { id: "content.installed.native", dimensions: ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "result-unknown", "secret-sentinel"] },
        { id: "content.installed.code", dimensions: ["approval", "secret-sentinel"] },
      ],
    },
    {
      outcome: "office",
      cases: [
        { id: "office.installed.native", dimensions: ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "result-unknown", "secret-sentinel", "non-local"] },
        { id: "office.installed.code", dimensions: ["unlisted-failure", "secret-sentinel"] },
      ],
    },
    {
      outcome: "typst",
      cases: [
        { id: "typst.installed.native", dimensions: ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "result-unknown", "confirmed-partial-file", "secret-sentinel", "non-local"] },
      ],
    },
    {
      outcome: "svg",
      cases: [
        { id: "svg.installed.native", dimensions: ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "result-unknown", "confirmed-partial-file", "secret-sentinel", "non-local"] },
        { id: "svg.installed.code", dimensions: ["secret-sentinel"] },
      ],
    },
    {
      outcome: "render",
      cases: [
        { id: "render.installed.native", dimensions: ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "confirmed-partial-file", "secret-sentinel", "non-local"] },
        { id: "render.installed.code", dimensions: ["approval", "secret-sentinel"] },
      ],
    },
    {
      outcome: "resource-discovery",
      cases: [
        { id: "resource-discovery.installed.native", dimensions: ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "confirmed-partial-file", "secret-sentinel", "non-local"] },
        { id: "resource-discovery.installed.code", dimensions: ["approval", "unlisted-failure", "secret-sentinel"] },
      ],
    },
  ] as const satisfies readonly {
    readonly outcome: string;
    readonly cases: readonly {
      readonly id: string;
      readonly dimensions: readonly ParitySafetyDimension[];
    }[];
  }[],
  mechanisms: [
    { id: "profile-origin", owner: "add-dsh-univer-work-authentication", evidence: "credential owner resolves the active origin" },
    { id: "persistent-grant", owner: "add-dsh-univer-work-authentication", evidence: "DSH Credentials owns pending and authenticated grants" },
    { id: "host-lifecycle", owner: "add-dsh-univer-work-plugin-shell", evidence: "Cordis activation and disposal replace daemon control" },
    { id: "catalog", owner: "add-dsh-univer-work-plugin-shell", evidence: "installed ToolRegistry and SkillRegistry replace help discovery" },
    { id: "skill-catalog", owner: "add-dsh-bundled-unit-topic-skills", evidence: "native Skill list/load replaces list/get/path" },
    { id: "browser-auth", owner: "add-dsh-univer-work-authentication", evidence: "browser approval replaces password input" },
    { id: "browser-deployment", owner: "add-dsh-render-verification-tools", evidence: "operator preflight and installed real-browser smoke replace setup" },
    { id: "resource-no-retention", owner: "add-dsh-api-resource-discovery-tools", evidence: "independent queries and exports retain no cache" },
    { id: "authoritative-viewer-origin", owner: "add-dsh-worktree-unit-tools", evidence: "review URL uses the current grant origin without caller override" },
    { id: "canonical-presentation", owner: "add-dsh-univer-work-plugin-shell", evidence: "closed canonical tool values replace JSON/text/path formatting" },
  ] as const,
  cliRoutes: [
    { path: "", kind: "presentation", evidence: "installed package catalog", presentationOptions: ["-v, --version"], results: [], presentations: ["help", "version"] },
    { path: "config", kind: "mechanism", mechanism: "profile-origin", results: [], presentations: ["help"] },
    { path: "config path", kind: "mechanism", mechanism: "profile-origin", presentationOptions: ["--json"], results: ["profile location"], presentations: ["json", "path", "text"] },
    { path: "config list", kind: "mechanism", mechanism: "profile-origin", presentationOptions: ["--json"], results: ["configuration entries"], presentations: ["json", "text"] },
    { path: "config get", kind: "mechanism", mechanism: "profile-origin", arguments: ["<key>"], presentationOptions: ["--json"], results: ["configuration entry"], presentations: ["json", "text"] },
    { path: "config set", kind: "mechanism", mechanism: "profile-origin", arguments: ["<key>", "<value>"], presentationOptions: ["--json"], results: ["configuration entry"], presentations: ["json", "text"] },
    { path: "config unset", kind: "mechanism", mechanism: "profile-origin", arguments: ["<key>"], presentationOptions: ["--json"], results: ["configuration entry"], presentations: ["json", "text"] },
    { path: "daemon", kind: "mechanism", mechanism: "host-lifecycle", results: [], presentations: ["help"] },
    { path: "daemon status", kind: "mechanism", mechanism: "host-lifecycle", presentationOptions: ["--json"], results: ["lifecycle state"], presentations: ["json", "text"] },
    { path: "daemon start", kind: "mechanism", mechanism: "host-lifecycle", presentationOptions: ["--json"], results: ["lifecycle state"], presentations: ["json", "text"] },
    { path: "daemon restart", kind: "mechanism", mechanism: "host-lifecycle", presentationOptions: ["--json"], results: ["lifecycle state"], presentations: ["json", "text"] },
    { path: "daemon stop", kind: "mechanism", mechanism: "host-lifecycle", presentationOptions: ["--json"], results: ["lifecycle state"], presentations: ["json", "text"] },
    { path: "api", kind: "outcome", outcomes: ["api-discovery"], arguments: ["[symbols...]"], results: ["Facade API entries"], presentations: ["text"] },
    { path: "api find", kind: "outcome", outcomes: ["api-discovery"], arguments: ["<terms...>"], options: ["--unit <unit>"], results: ["Facade API matches"], presentations: ["text"] },
    { path: "api show", kind: "outcome", outcomes: ["api-discovery"], arguments: ["<symbols...>"], results: ["Facade API entries"], presentations: ["text"] },
    { path: "resources", kind: "presentation", evidence: "resource catalog", results: [], presentations: ["help"] },
    { path: "resources registries", kind: "outcome", outcomes: ["resource-discovery"], presentationOptions: ["--json"], results: ["resource registries"], presentations: ["json", "text"] },
    { path: "resources find", kind: "outcome", outcomes: ["resource-discovery"], arguments: ["<queries...>"], options: ["--registry <id>", "--limit <number>"], presentationOptions: ["--json"], results: ["resource matches"], presentations: ["json", "text"] },
    { path: "resources export", kind: "outcome", outcomes: ["resource-discovery"], arguments: ["<handles...>"], options: ["--out <directory>"], presentationOptions: ["--json"], results: ["confirmed local SVG files"], presentations: ["json", "text"] },
    { path: "resources cache", kind: "mechanism", mechanism: "resource-no-retention", results: [], presentations: ["help"] },
    { path: "resources cache path", kind: "mechanism", mechanism: "resource-no-retention", presentationOptions: ["--json"], results: ["no retained cache"], presentations: ["json", "path", "text"] },
    { path: "resources cache clear", kind: "mechanism", mechanism: "resource-no-retention", presentationOptions: ["--json"], results: ["no retained cache"], presentations: ["json", "text"] },
    { path: "skills", kind: "mechanism", mechanism: "skill-catalog", presentationOptions: ["--json"], results: ["Skill summaries"], presentations: ["json", "text"] },
    { path: "skills list", kind: "mechanism", mechanism: "skill-catalog", presentationOptions: ["--json"], results: ["Skill summaries"], presentations: ["json", "text"] },
    { path: "skills get", kind: "mechanism", mechanism: "skill-catalog", arguments: ["[name]"], mechanismOptions: ["--all", "--full"], presentationOptions: ["--json"], results: ["Skill bodies"], presentations: ["json", "text"] },
    { path: "skills path", kind: "mechanism", mechanism: "skill-catalog", arguments: ["[name]"], presentationOptions: ["--json"], results: ["packed Skill identity"], presentations: ["json", "path", "text"] },
    { path: "login", kind: "outcome", outcomes: ["authentication"], mechanismOptions: ["--complete", "--username <name>", "--password-stdin"], presentationOptions: ["--json"], results: ["browser approval or authenticated identity"], presentations: ["json", "text"] },
    { path: "whoami", kind: "outcome", outcomes: ["authentication"], presentationOptions: ["--json"], results: ["authoritative identity"], presentations: ["json", "text"] },
    { path: "logout", kind: "outcome", outcomes: ["authentication"], presentationOptions: ["--json"], results: ["cleared grant identity"], presentations: ["json", "text"] },
    { path: "space", kind: "presentation", evidence: "Space and Node catalog", results: [], presentations: ["help"] },
    { path: "space list", kind: "outcome", outcomes: ["space-node"], presentationOptions: ["--json"], results: ["Spaces"], presentations: ["json", "text"] },
    { path: "space browse", kind: "outcome", outcomes: ["space-node"], arguments: ["<space>"], options: ["--parent <node>", "--recursive", "--resource-kind <kind>", "--unit-type <type>"], presentationOptions: ["--json"], results: ["Nodes"], presentations: ["json", "text"] },
    { path: "space find", kind: "outcome", outcomes: ["space-node"], arguments: ["<query...>"], options: ["--space <id>", "--resource-kind <kind>", "--unit-type <type>"], presentationOptions: ["--json"], results: ["Nodes"], presentations: ["json", "text"] },
    { path: "space node", kind: "presentation", evidence: "Node mutation catalog", results: [], presentations: ["help"] },
    { path: "space node create", kind: "outcome", outcomes: ["space-node"], arguments: ["<space>"], options: ["--name <name>", "--parent <node>"], presentationOptions: ["--json"], results: ["created Node"], presentations: ["json", "text"] },
    { path: "space node rename", kind: "outcome", outcomes: ["space-node"], arguments: ["<node>"], options: ["--name <name>"], presentationOptions: ["--json"], results: ["renamed Node"], presentations: ["json", "text"] },
    { path: "space node move", kind: "outcome", outcomes: ["space-node"], arguments: ["<node>"], options: ["--parent <node>", "--root"], presentationOptions: ["--json"], results: ["moved Node"], presentations: ["json", "text"] },
    { path: "space node trash", kind: "outcome", outcomes: ["space-node"], arguments: ["<node>"], presentationOptions: ["--json"], results: ["Trash batch"], presentations: ["json", "text"] },
    { path: "worktree", kind: "presentation", evidence: "Worktree catalog", results: [], presentations: ["help"] },
    { path: "worktree list", kind: "outcome", outcomes: ["worktree-unit"], options: ["--view <view>", "--scope <scope>", "--space <id>"], presentationOptions: ["--json"], results: ["Worktrees"], presentations: ["json", "text"] },
    { path: "worktree get", kind: "outcome", outcomes: ["worktree-unit"], arguments: ["<worktree>"], presentationOptions: ["--json"], results: ["Worktree"], presentations: ["json", "text"] },
    { path: "worktree create", kind: "outcome", outcomes: ["worktree-unit"], options: ["--name <name>", "--scope <scope>", "--space <id>", "--idempotency-key <key>", "--visibility <visibility>"], presentationOptions: ["--json"], results: ["created Worktree"], presentations: ["json", "text"] },
    { path: "worktree update", kind: "outcome", outcomes: ["worktree-unit"], arguments: ["<worktree>"], options: ["--name <name>", "--visibility <visibility>"], presentationOptions: ["--json"], results: ["updated Worktree"], presentations: ["json", "text"] },
    { path: "worktree ready", kind: "outcome", outcomes: ["worktree-unit"], arguments: ["<worktree>"], presentationOptions: ["--json"], results: ["authoritative Worktree state"], presentations: ["json", "text"] },
    { path: "worktree reopen", kind: "outcome", outcomes: ["worktree-unit"], arguments: ["<worktree>"], presentationOptions: ["--json"], results: ["authoritative Worktree state"], presentations: ["json", "text"] },
    { path: "worktree merge", kind: "outcome", outcomes: ["worktree-unit"], arguments: ["<worktree>"], presentationOptions: ["--json"], results: ["authoritative Worktree state"], presentations: ["json", "text"] },
    { path: "worktree discard", kind: "outcome", outcomes: ["worktree-unit"], arguments: ["<worktree>"], presentationOptions: ["--json"], results: ["authoritative Worktree state"], presentations: ["json", "text"] },
    { path: "unit", kind: "presentation", evidence: "Unit catalog", results: [], presentations: ["help"] },
    { path: "unit list", kind: "outcome", outcomes: ["worktree-unit"], options: ["--worktree <id>"], presentationOptions: ["--json"], results: ["Worktree Units"], presentations: ["json", "text"] },
    { path: "unit add", kind: "outcome", outcomes: ["worktree-unit"], options: ["--worktree <id>", "--resource <id>"], presentationOptions: ["--json"], results: ["added Unit"], presentations: ["json", "text"] },
    { path: "unit create", kind: "outcome", outcomes: ["worktree-unit"], options: ["--worktree <id>", "--space <id>", "--type <type>", "--name <name>", "--parent <node>", "--idempotency-key <key>"], presentationOptions: ["--json"], results: ["created Unit"], presentations: ["json", "text"] },
    { path: "import", kind: "outcome", outcomes: ["office"], options: ["--file <source>", "--worktree <id>", "--space <id>", "--type <type>", "--name <name>", "--parent <node>", "--idempotency-key <key>"], presentationOptions: ["--json"], results: ["imported Unit"], presentations: ["json", "text"] },
    { path: "export", kind: "outcome", outcomes: ["office"], arguments: ["<output>"], options: ["--worktree <id>", "--unit <id>"], presentationOptions: ["--json"], results: ["confirmed Office file"], presentations: ["json", "text"] },
    { path: "blob", kind: "presentation", evidence: "Blob catalog", results: [], presentations: ["help"] },
    { path: "blob upload", kind: "outcome", outcomes: ["file-transfer"], options: ["--file <source>", "--space <id>", "--parent <node>", "--name <name>", "--media-type <mime>", "--idempotency-key <key>"], presentationOptions: ["--json"], results: ["Blob Resource"], presentations: ["json", "text"] },
    { path: "blob get", kind: "outcome", outcomes: ["file-transfer"], arguments: ["<resource>"], presentationOptions: ["--json"], results: ["Blob metadata"], presentations: ["json", "text"] },
    { path: "blob download", kind: "outcome", outcomes: ["file-transfer"], arguments: ["<output>"], options: ["--resource <id>", "--force"], presentationOptions: ["--json"], results: ["confirmed Blob file"], presentations: ["json", "text"] },
    { path: "asset", kind: "presentation", evidence: "Asset catalog", results: [], presentations: ["help"] },
    { path: "asset download", kind: "outcome", outcomes: ["file-transfer"], arguments: ["<output>"], options: ["--id <file-id>", "--worktree <id>", "--force"], presentationOptions: ["--json"], results: ["confirmed Asset file"], presentations: ["json", "text"] },
    { path: "open", kind: "outcome", outcomes: ["worktree-unit"], options: ["--worktree <id>", "--unit <id>"], mechanismOptions: ["--viewer-url <url>"], presentationOptions: ["--json"], results: ["authoritative review URL"], presentations: ["json", "text"] },
    { path: "screenshot", kind: "outcome", outcomes: ["render"], options: ["--unit <unit-id>", "--pages <pages>", "--contact-slide", "--tile <columns>x<rows>", "--sheet <name>", "--range <a1-range>", "--region <left,top,width,height>", "--elements <ids>", "--padding <pixels>", "--scale <factor>", "--out <destination>", "--worktree <worktree-id>", "--trunk"], presentationOptions: ["--json"], results: ["confirmed PNG files"], presentations: ["json", "text"] },
    { path: "screenshot setup", kind: "mechanism", mechanism: "browser-deployment", mechanismOptions: ["--force"], presentationOptions: ["--json"], results: ["browser preflight"], presentations: ["json", "text"] },
    { path: "lint", kind: "outcome", outcomes: ["render"], options: ["--unit <unit-id>", "--pages <pages>", "--worktree <worktree-id>"], presentationOptions: ["--json"], results: ["layout findings"], presentations: ["json", "text"] },
    { path: "execute", kind: "outcome", outcomes: ["content"], options: ["--worktree <id>", "--unit <id>", "-e <js>", "--code <js>", "--script <path>"], presentationOptions: ["--json"], results: ["canonical execution value and commit state"], presentations: ["json", "text"] },
    { path: "compile-typst", kind: "outcome", outcomes: ["typst"], arguments: ["<bundle>"], options: ["--apply", "--worktree <id>", "--space <id>", "--parent <node>", "--idempotency-key <key>", "--out <program.js>", "--diagnostics-out <json>", "--preview-dir <directory>"], presentationOptions: ["--json"], results: ["compiled artifacts or created Doc"], presentations: ["json", "text"] },
    { path: "compile-svg", kind: "outcome", outcomes: ["svg"], arguments: ["<file.svg>"], options: ["--estimate-text-size", "--page <number>", "--add", "--out <path>", "--apply", "--worktree <id>", "--unit <id>"], presentationOptions: ["--json"], results: ["generated program or applied Slide page"], presentations: ["json", "text"] },
    { path: "inspect", kind: "outcome", outcomes: ["content"], arguments: ["<target>", "[selectors...]"], options: ["--unit <unit-id>", "--worksheet <selector>", "--trunk", "--worktree <id>"], presentationOptions: ["--json"], results: ["canonical structured content"], presentations: ["json", "text"] },
  ] as const satisfies readonly CliRoute[],
} as const;
