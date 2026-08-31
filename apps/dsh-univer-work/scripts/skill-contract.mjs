export const ACCEPTED_WORKSPACE_TOOL_NAMES = [
  "workspace_api_find",
  "workspace_api_show",
  "workspace_asset_download",
  "workspace_auth_complete",
  "workspace_auth_logout",
  "workspace_auth_start",
  "workspace_auth_whoami",
  "workspace_blob_download",
  "workspace_blob_get",
  "workspace_blob_upload",
  "workspace_content_execute",
  "workspace_content_inspect",
  "workspace_layout_lint",
  "workspace_node_create",
  "workspace_node_move",
  "workspace_node_rename",
  "workspace_node_trash",
  "workspace_office_export",
  "workspace_office_import",
  "workspace_resource_export",
  "workspace_resource_find",
  "workspace_resource_registries",
  "workspace_screenshot",
  "workspace_space_browse",
  "workspace_space_find",
  "workspace_space_list",
  "workspace_svg_apply",
  "workspace_svg_compile",
  "workspace_typst_apply",
  "workspace_typst_compile",
  "workspace_unit_add",
  "workspace_unit_create",
  "workspace_unit_list",
  "workspace_worktree_create",
  "workspace_worktree_discard",
  "workspace_worktree_get",
  "workspace_worktree_list",
  "workspace_worktree_merge",
  "workspace_worktree_ready",
  "workspace_worktree_reopen",
  "workspace_worktree_review_url",
  "workspace_worktree_update",
];

const contracts = {
  base: {
    required: ["workspace_worktree_create", "workspace_unit_add", "workspace_unit_create", "workspace_unit_list", "workspace_content_execute", "workspace_api_find", "workspace_api_show", "workspace_office_import", "workspace_office_export", "workspace_screenshot", "workspace_worktree_review_url"],
    forbidden: ["workspace_content_inspect", "workspace_typst_compile", "workspace_typst_apply", "workspace_svg_compile", "workspace_svg_apply", "workspace_resource_registries", "workspace_resource_find", "workspace_resource_export", "workspace_layout_lint"],
    anchors(body) {
      containsAll("base", body, ['const unitId = "<selected-unit-id>"', "api.getBase(unitId)", "table.getFormulaName()", "[[#This Row]", "[[#Data]", "record.setAttachments()", "ImageSourceType.BASE64", "later `workspace_content_execute`"]);
      before("base", body, 'const unitId = "<selected-unit-id>"', "api.getBase(unitId)");
    },
  },
  board: {
    required: ["workspace_worktree_create", "workspace_unit_add", "workspace_unit_create", "workspace_unit_list", "workspace_content_execute", "workspace_api_find", "workspace_api_show", "workspace_resource_registries", "workspace_resource_find", "workspace_resource_export", "workspace_screenshot", "workspace_worktree_review_url"],
    forbidden: ["workspace_content_inspect", "workspace_office_import", "workspace_office_export", "workspace_typst_compile", "workspace_typst_apply", "workspace_svg_compile", "workspace_svg_apply", "workspace_layout_lint"],
    anchors(body) {
      before("board", body, "board.insertShapes()", "board.insertConnectors()");
      before("board", body, "board.analyzeModelLayout(48)", "workspace_screenshot");
      containsAll("board", body, ["board.normalizeConnectorRouting(ids)", "at most once", "FBoard.newChart", "await board.insertChart(info)", "stable resource handles"]);
    },
  },
  doc: {
    required: ["workspace_worktree_create", "workspace_unit_add", "workspace_unit_create", "workspace_unit_list", "workspace_content_execute", "workspace_content_inspect", "workspace_api_find", "workspace_api_show", "workspace_office_import", "workspace_office_export", "workspace_typst_compile", "workspace_typst_apply", "workspace_screenshot", "workspace_worktree_review_url"],
    forbidden: ["workspace_svg_compile", "workspace_svg_apply", "workspace_resource_registries", "workspace_resource_find", "workspace_resource_export", "workspace_layout_lint"],
    anchors(body) {
      containsAll("doc", body, ["injects `doc`", "`dataStream`", "`\\r`", "`\\r\\n`", "doc.isTraditional()", "FDocument.newChart", "await doc.insertChart(info)"]);
    },
  },
  embed: {
    required: ["workspace_content_execute", "workspace_api_find", "workspace_api_show", "workspace_screenshot", "workspace_worktree_review_url"],
    forbidden: ["workspace_worktree_create", "workspace_unit_add", "workspace_unit_create", "workspace_content_inspect", "workspace_office_import", "workspace_office_export", "workspace_typst_compile", "workspace_typst_apply", "workspace_svg_compile", "workspace_svg_apply", "workspace_resource_registries", "workspace_resource_find", "workspace_resource_export", "workspace_layout_lint"],
    anchors(body) {
      containsAll("embed", body, ['"#unit=" + sourceUnitId + "&type=doc"', "loadAsync()", "persisted ResourceRef", "loaded child ID and type", "Host anchor", "Do not stage a Source merely to read it"]);
    },
  },
  sheet: {
    required: ["workspace_worktree_create", "workspace_unit_add", "workspace_unit_create", "workspace_unit_list", "workspace_content_execute", "workspace_content_inspect", "workspace_api_find", "workspace_api_show", "workspace_office_import", "workspace_office_export", "workspace_screenshot", "workspace_worktree_review_url"],
    forbidden: ["workspace_typst_compile", "workspace_typst_apply", "workspace_svg_compile", "workspace_svg_apply", "workspace_resource_registries", "workspace_resource_find", "workspace_resource_export", "workspace_layout_lint"],
    anchors(body) {
      containsAll("sheet", body, ["injects `workbook`", "workbook.getActiveSheet()", "explicit `ICellData`", "`v`", "`t`", "`f`", "`s`", "`p`", "stored `v` and `t` with `displayValue`"]);
      before("sheet", body, "workbook.getActiveSheet()", "onCalculationResultApplied();");
      before("sheet", body, "onCalculationResultApplied();", "setFormula(\"=A1+A2\")");
    },
  },
  slide: {
    required: ["workspace_worktree_create", "workspace_unit_add", "workspace_unit_create", "workspace_unit_list", "workspace_content_execute", "workspace_content_inspect", "workspace_api_find", "workspace_api_show", "workspace_office_import", "workspace_office_export", "workspace_svg_compile", "workspace_svg_apply", "workspace_resource_registries", "workspace_resource_find", "workspace_resource_export", "workspace_screenshot", "workspace_layout_lint", "workspace_worktree_review_url"],
    forbidden: ["workspace_typst_compile", "workspace_typst_apply"],
    anchors(body) {
      containsAll("slide", body, ["Tool page selectors are one-based", "Facade indexes", "zero-based", "Rework replaces the complete page", "never repair a page by overlaying", "Keep exported SVG resources as files", "FSlide.newChart", "await slide.insertChart(info)"]);
      before("slide", body, "workspace_layout_lint", "workspace_screenshot", true);
    },
  },
  "cross-unit-formula": {
    required: ["workspace_content_execute", "workspace_api_find", "workspace_api_show", "workspace_screenshot", "workspace_worktree_review_url"],
    forbidden: ["workspace_worktree_create", "workspace_unit_add", "workspace_unit_create", "workspace_content_inspect", "workspace_office_import", "workspace_office_export", "workspace_typst_compile", "workspace_typst_apply", "workspace_svg_compile", "workspace_svg_apply", "workspace_resource_registries", "workspace_resource_find", "workspace_resource_export", "workspace_layout_lint"],
    anchors(body) {
      containsAll("cross-unit-formula", body, ["Source's stable `unitId`, Unit type, qualifier", "Sheet range or Base table-column", "buildReference()", "upsertExternalReference()", "persisted qualifier binding", "formula text", "calculated value", "Do not stage a Source merely to read it"]);
      before("cross-unit-formula", body, "onCalculationResultApplied(30_000)", "setFormula(\"=SUM(");
    },
  },
};

export const BUNDLED_SKILL_NAMES = Object.keys(contracts).sort();

export function validateBundledSkillSources(sources, catalog = ACCEPTED_WORKSPACE_TOOL_NAMES) {
  const expected = new Set(BUNDLED_SKILL_NAMES);
  const actual = sources.map(({ name }) => name).sort();
  if (actual.length !== expected.size || actual.some((name) => !expected.has(name))) {
    throw new Error(`bundled Skill names differ: ${actual.join(", ")}`);
  }
  const known = new Set(catalog);
  for (const { name, source } of sources) {
    const contract = contracts[name];
    if (contract === undefined) throw new Error(`unknown bundled Skill: ${name}`);
    const match = source.match(/^---\r?\nname: ([^\r\n]+)\r?\ndescription: ([^\r\n]+)\r?\n---\r?\n\r?\n([\s\S]+)$/u);
    if (match === null || match[1] !== name || match[2].trim() === "" || match[3].trim() === "") {
      throw new Error(`${name}: invalid fixed frontmatter or body`);
    }
    const body = match[3];
    if (/univer-workspace-cli|\bskills get\b|(?:^|[\s"'`(])--[A-Za-z][A-Za-z0-9-]*(?=$|[=\s"'`.,;:!?)\]])|(?:^|[\s"'`(])-[A-Za-z](?=$|[=\s"'`.,;:!?)\]])|\b(?:CLI config|CLI Session|CLI daemon|Commander)\b|(?:^|[\s"'`(])\/(?!\/)[^\s"'`)<>{}\]]+|(?:^|[\s"'`(])[A-Za-z]:[\\/][^\s"'`)<>{}\]]+/mu.test(body)) {
      throw new Error(`${name}: prohibited CLI or checkout syntax`);
    }
    const operations = new Set(body.match(/\bworkspace_[a-z0-9_]+\b/gu) ?? []);
    for (const required of contract.required) {
      if (!operations.has(required)) throw new Error(`${name}: missing required operation ${required}`);
    }
    for (const forbidden of contract.forbidden) {
      if (operations.has(forbidden)) throw new Error(`${name}: forbidden operation ${forbidden}`);
    }
    for (const operation of operations) {
      if (!known.has(operation)) throw new Error(`${name}: unknown operation ${operation}`);
    }
    contract.anchors(body);
  }
}

function containsAll(name, body, anchors) {
  for (const anchor of anchors) {
    if (!body.includes(anchor)) throw new Error(`${name}: missing semantic anchor ${anchor}`);
  }
}

function before(name, body, first, second, useLast = false) {
  const left = body.indexOf(first);
  const right = useLast ? body.lastIndexOf(second) : body.indexOf(second);
  if (left < 0 || right < 0 || left >= right) throw new Error(`${name}: semantic order ${first} before ${second} is missing`);
}
