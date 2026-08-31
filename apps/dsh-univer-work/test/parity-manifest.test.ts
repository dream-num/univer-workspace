import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PARITY_MANIFEST } from "../src/parity-manifest.js";
import {
  ACCEPTED_WORKSPACE_TOOL_NAMES,
  BUNDLED_SKILL_NAMES,
} from "../scripts/skill-contract.mjs";
import { validateParitySafetyResults } from "../scripts/parity-safety-reporter.mjs";

const EXPECTED_OWNERS = [
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
] as const;
const EXPECTED_SKILLS = ["core", ...BUNDLED_SKILL_NAMES].sort();
const FROZEN_WORKSPACE_COMMIT = "a01adf28bfdfbf098ecf66653d520d08ecac4117";
const ACCEPTED_SURFACE = JSON.parse(readFileSync(
  new URL("./fixtures/parity-accepted-surface.json", import.meta.url),
  "utf8",
)) as AcceptedSurfaceEvidence;
const EXPECTED_SAFETY_DIMENSIONS = new Map<string, readonly string[]>([
  ["authentication", ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "result-unknown", "secret-sentinel"]],
  ["space-node", ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "result-unknown", "secret-sentinel"]],
  ["worktree-unit", ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "result-unknown", "secret-sentinel"]],
  ["file-transfer", ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "result-unknown", "confirmed-partial-file", "secret-sentinel", "non-local"]],
  ["content", ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "result-unknown", "secret-sentinel"]],
  ["office", ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "result-unknown", "secret-sentinel", "non-local"]],
  ["typst", ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "result-unknown", "confirmed-partial-file", "secret-sentinel", "non-local"]],
  ["svg", ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "result-unknown", "confirmed-partial-file", "secret-sentinel", "non-local"]],
  ["render", ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "confirmed-partial-file", "secret-sentinel", "non-local"]],
  ["resource-discovery", ["approval", "allowlisted-failure", "unlisted-failure", "caller-cancellation", "owner-cancellation", "confirmed-partial-file", "secret-sentinel", "non-local"]],
]);
const REQUIRED_SAFETY_TEST_IDENTITIES = new Map([
  ["render.installed.native:non-local", [
    "test/render-tools.test.ts",
    "Workspace render closed contracts > orders screenshot preflight as policy, local proof, pure arguments, then Session containment",
  ]],
  ["typst.installed.native:allowlisted-failure", [
    "test/typst-tools.test.ts",
    "Workspace Typst real ToolRuntime > preserves uncertain-create identity and guidance without dependency secrets",
  ]],
] as const);
describe("frozen Workspace CLI parity manifest", () => {
  it("covers the exact CLI surface, production catalog, owners, and acceptance routes", async () => {
    validateManifest(PARITY_MANIFEST, ACCEPTED_WORKSPACE_TOOL_NAMES, EXPECTED_SKILLS, ACCEPTED_SURFACE);
    expect(PARITY_MANIFEST.baseline.workspaceCommit).toBe(FROZEN_WORKSPACE_COMMIT);
    expect(execFileSync(
      "git",
      ["diff", "--name-only", FROZEN_WORKSPACE_COMMIT, "--", "apps/cli/src"],
      { cwd: resolve(import.meta.dirname, "../../.."), encoding: "utf8" },
    )).toBe("");
    const commanderSurface = readFrozenCommanderSurface();
    expect(commanderSurface).toEqual(PARITY_MANIFEST.cliRoutes.map((route) => ({
      arguments: "arguments" in route ? route.arguments : [],
      options: [
        ...("options" in route ? route.options : []),
        ...("mechanismOptions" in route ? route.mechanismOptions : []),
        ...("presentationOptions" in route ? route.presentationOptions : []),
      ].sort(),
      path: route.path,
    })));
    expect({
      arguments: commanderSurface.reduce((count, route) => count + route.arguments.length, 0),
      commands: commanderSurface.length,
      options: commanderSurface.reduce((count, route) => count + route.options.length, 0),
    }).toEqual({ arguments: 31, commands: 67, options: 158 });
    await Promise.all(PARITY_MANIFEST.outcomes.map(async ({ productionEntry }) =>
      await access(resolve(import.meta.dirname, "..", productionEntry))));
  });

  it("fails on every forbidden manifest drift class", () => {
    const mutations: readonly [string, (manifest: MutableManifest) => void, RegExp][] = [
      ["omitted CLI surface", (manifest) => { manifest.cliRoutes.pop(); }, /CLI command total/u],
      ["unclassified CLI surface", (manifest) => { manifest.cliRoutes[0]!.kind = "unknown"; }, /unclassified CLI route/u],
      ["unknown owner", (manifest) => { manifest.outcomes[0]!.owner = "unknown"; }, /unknown owner/u],
      ["duplicate owner", (manifest) => { manifest.owners[1] = manifest.owners[0]!; }, /owner set/u],
      ["absent operation", (manifest) => { manifest.outcomes[1]!.operations.pop(); }, /operation catalog/u],
      ["absent Skill", (manifest) => { manifest.outcomes.at(-1)!.skills.pop(); }, /Skill catalog/u],
      ["missing case id", (manifest) => { manifest.outcomes[0]!.caseIds[0] = "missing"; }, /missing acceptance case/u],
      ["test-owned implementation", (manifest) => { manifest.outcomes[0]!.productionEntry = "test/fake.ts"; }, /test-owned replacement/u],
      ["missing safety dimension", (manifest) => { manifest.safetyCases[0]!.cases[0]!.dimensions.pop(); }, /accepted safety dimension evidence/u],
      ["wrong Native safety case", (manifest) => { manifest.safetyCases[0]!.cases[0]!.id = "space-node.installed.native"; }, /safety case owner/u],
      ["wrong Code safety case", (manifest) => { manifest.safetyCases[0]!.cases[1]!.id = "space-node.installed.code"; }, /safety case owner/u],
    ];
    for (const [name, mutate, failure] of mutations) {
      const manifest = structuredClone(PARITY_MANIFEST) as unknown as MutableManifest;
      mutate(manifest);
      expect(
        () => validateManifest(manifest, ACCEPTED_WORKSPACE_TOOL_NAMES, EXPECTED_SKILLS, ACCEPTED_SURFACE),
        name,
      ).toThrow(failure);
    }
  });

  it("rejects every independent ownership, runner, safety, and CLI result evidence drift", () => {
    const wrongOwner = structuredClone(PARITY_MANIFEST) as unknown as MutableManifest;
    const outcome = wrongOwner.outcomes[0]!;
    outcome.owner = wrongOwner.owners[1]!;
    for (const caseId of outcome.caseIds) {
      wrongOwner.acceptanceCases.find(({ id }) => id === caseId)!.owner = outcome.owner;
    }
    expect(() => validateManifest(
      wrongOwner,
      ACCEPTED_WORKSPACE_TOOL_NAMES,
      EXPECTED_SKILLS,
      ACCEPTED_SURFACE,
    )).toThrow(/accepted outcome owner evidence/u);

    const wrongCases = structuredClone(PARITY_MANIFEST) as unknown as MutableManifest;
    const first = wrongCases.outcomes[0]!;
    const second = wrongCases.outcomes.at(-1)!;
    [first.caseIds, second.caseIds] = [second.caseIds, first.caseIds];
    for (const target of [first, second]) {
      for (const caseId of target.caseIds) {
        const acceptanceCase = wrongCases.acceptanceCases.find(({ id }) => id === caseId)!;
        acceptanceCase.outcome = target.id;
        acceptanceCase.owner = target.owner;
      }
    }
    expect(() => validateManifest(
      wrongCases,
      ACCEPTED_WORKSPACE_TOOL_NAMES,
      EXPECTED_SKILLS,
      ACCEPTED_SURFACE,
    )).toThrow(/accepted runner case evidence/u);

    const wrongResult = structuredClone(PARITY_MANIFEST) as unknown as MutableManifest;
    wrongResult.cliRoutes[0]!.results.push("invented result");
    expect(() => validateManifest(
      wrongResult,
      ACCEPTED_WORKSPACE_TOOL_NAMES,
      EXPECTED_SKILLS,
      ACCEPTED_SURFACE,
    )).toThrow(/accepted CLI result and presentation evidence/u);

    const wrongSkills = structuredClone(PARITY_MANIFEST) as unknown as MutableManifest;
    const worktree = wrongSkills.outcomes.find(({ id }) => id === "worktree-unit")!;
    const topics = wrongSkills.outcomes.find(({ id }) => id === "unit-topic-skills")!;
    worktree.skills[worktree.skills.indexOf("core")] = "base";
    topics.skills[topics.skills.indexOf("base")] = "core";
    expect(() => validateManifest(
      wrongSkills,
      ACCEPTED_WORKSPACE_TOOL_NAMES,
      EXPECTED_SKILLS,
      ACCEPTED_SURFACE,
    )).toThrow(/accepted Skill owner evidence/u);

    const wrongDimension = structuredClone(ACCEPTED_SURFACE);
    wrongDimension.safetyDimensions[0]![1] = "owner-cancellation";
    expect(() => validateManifest(
      PARITY_MANIFEST,
      ACCEPTED_WORKSPACE_TOOL_NAMES,
      EXPECTED_SKILLS,
      wrongDimension,
    )).toThrow(/accepted safety dimension evidence/u);

    for (const [caseId, dimension, passingButWrong] of [
      [
        "render.installed.native",
        "non-local",
        "Workspace render closed contracts > does not ask or write for read-only layout lint",
      ],
      [
        "typst.installed.native",
        "allowlisted-failure",
        "Workspace Typst real ToolRuntime > publishes the exact synced fixed layout and preserves compile-only error diagnostics",
      ],
    ] as const) {
      const wrongSemanticIdentity = structuredClone(ACCEPTED_SURFACE);
      wrongSemanticIdentity.safetyDimensions.find(([id, safetyDimension]) =>
        id === caseId && safetyDimension === dimension)![3] = passingButWrong;
      expect(() => validateManifest(
        PARITY_MANIFEST,
        ACCEPTED_WORKSPACE_TOOL_NAMES,
        EXPECTED_SKILLS,
        wrongSemanticIdentity,
      )).toThrow(/required safety test identity differs/u);
    }
  });

  it("joins every safety key to its exact passed owner test without cross-case substitution", () => {
    const results = ACCEPTED_SURFACE.safetyDimensions.map(([, , file, fullName]) =>
      [file, fullName, "passed"] as [string, string, "passed"]);
    expect(() => validateParitySafetyResults(ACCEPTED_SURFACE.safetyDimensions, results)).not.toThrow();

    const contentUnknown = ACCEPTED_SURFACE.safetyDimensions.find(([caseId, dimension]) =>
      caseId === "content.installed.native" && dimension === "result-unknown")!;
    const withoutContentUnknown = results.filter(([file, fullName]) =>
      file !== contentUnknown[2] || fullName !== contentUnknown[3]);
    expect(() => validateParitySafetyResults([contentUnknown], withoutContentUnknown)).toThrow(
      /content\.installed\.native:result-unknown.*missing/u,
    );

    const nativeSecret = ACCEPTED_SURFACE.safetyDimensions.find(([caseId, dimension]) =>
      caseId === "authentication.installed.native" && dimension === "secret-sentinel")!;
    const codeSecret = ACCEPTED_SURFACE.safetyDimensions.find(([caseId, dimension]) =>
      caseId === "authentication.installed.code" && dimension === "secret-sentinel")!;
    expect(() => validateParitySafetyResults([nativeSecret], [[codeSecret[2], codeSecret[3], "passed"]])).toThrow(
      /authentication\.installed\.native:secret-sentinel.*missing/u,
    );
    expect(() => validateParitySafetyResults(
      [codeSecret],
      [[codeSecret[2], codeSecret[3], "skipped"]],
    )).toThrow(/authentication\.installed\.code:secret-sentinel.*skipped/u);

    const typstPartial = ACCEPTED_SURFACE.safetyDimensions.find(([caseId, dimension]) =>
      caseId === "typst.installed.native" && dimension === "confirmed-partial-file")!;
    const discoveryPartial = ACCEPTED_SURFACE.safetyDimensions.find(([caseId, dimension]) =>
      caseId === "resource-discovery.installed.native" && dimension === "confirmed-partial-file")!;
    expect(() => validateParitySafetyResults(
      [typstPartial],
      [[discoveryPartial[2], discoveryPartial[3], "passed"]],
    )).toThrow(/typst\.installed\.native:confirmed-partial-file.*missing/u);

    const foreignUnknown = ["authentication", "svg", "typst"].map((outcome) =>
      ACCEPTED_SURFACE.safetyDimensions.find(([caseId, dimension]) =>
        caseId === `${outcome}.installed.native` && dimension === "result-unknown")!);
    expect(() => validateParitySafetyResults(
      foreignUnknown,
      [[contentUnknown[2], contentUnknown[3], "passed"]],
    )).toThrow(/authentication\.installed\.native:result-unknown[\s\S]*svg\.installed\.native:result-unknown[\s\S]*typst\.installed\.native:result-unknown/u);

    const nativeApproval = ACCEPTED_SURFACE.safetyDimensions.find(([caseId, dimension]) =>
      caseId === "content.installed.native" && dimension === "approval")!;
    const codeApproval = ACCEPTED_SURFACE.safetyDimensions.find(([caseId, dimension]) =>
      caseId === "content.installed.code" && dimension === "approval")!;
    expect(() => validateParitySafetyResults(
      [nativeApproval],
      [[codeApproval[2], codeApproval[3], "passed"]],
    )).toThrow(/content\.installed\.native:approval.*missing/u);
  });
});

type AcceptedSurfaceEvidence = {
  operations: Array<[string, string, string]>;
  skills: Array<[string, string, string]>;
  outcomes: Array<[string, string]>;
  runnerCases: Array<[string, string, string, "code" | "native"]>;
  safetyDimensions: Array<[string, string, string, string]>;
  cliResultForms: Array<[string, string[], string[]]>;
};

type MutableManifest = {
  cliSurfaceTotals: { commands: number; arguments: number; options: number };
  owners: string[];
  acceptanceCases: Array<{ id: string; outcome: string; owner: string; mode: "code" | "native" }>;
  outcomes: Array<{
    id: string;
    owner: string;
    operations: string[];
    skills: string[];
    productionEntry: string;
    caseIds: string[];
  }>;
  mechanisms: Array<{ id: string; owner: string; evidence: string }>;
  safetyCases: Array<{
    outcome: string;
    cases: Array<{ id: string; dimensions: string[] }>;
  }>;
  cliRoutes: Array<{
    path: string;
    kind: string;
    outcomes?: string[];
    mechanism?: string;
    evidence?: string;
    arguments?: string[];
    options?: string[];
    mechanismOptions?: string[];
    presentationOptions?: string[];
    results: string[];
    presentations?: string[];
  }>;
};

function validateManifest(
  manifest: MutableManifest | typeof PARITY_MANIFEST,
  acceptedOperations: readonly string[],
  acceptedSkills: readonly string[],
  acceptedSurface: AcceptedSurfaceEvidence,
): void {
  const owners = manifest.owners as readonly string[];
  if (!sameSet(owners, EXPECTED_OWNERS)) throw new Error("owner set is not the twelve accepted Changes");
  const ownerSet = new Set(owners);
  const cases = new Map<string, { mode: "code" | "native"; outcome: string; owner: string }>();
  for (const entry of manifest.acceptanceCases) {
    if (cases.has(entry.id)) throw new Error(`duplicate acceptance case: ${entry.id}`);
    if (!ownerSet.has(entry.owner)) throw new Error(`unknown owner for acceptance case: ${entry.id}`);
    cases.set(entry.id, { mode: entry.mode, outcome: entry.outcome, owner: entry.owner });
  }

  const outcomeIds = new Set<string>();
  const operations: string[] = [];
  const skills: string[] = [];
  for (const outcome of manifest.outcomes) {
    if (outcomeIds.has(outcome.id)) throw new Error(`duplicate outcome: ${outcome.id}`);
    outcomeIds.add(outcome.id);
    if (!ownerSet.has(outcome.owner)) throw new Error(`unknown owner for outcome: ${outcome.id}`);
    if (!/^src\/(?!.*(?:test|fixture))[^/]+\.ts$/u.test(outcome.productionEntry)) {
      throw new Error(`test-owned replacement implementation: ${outcome.id}`);
    }
    if (outcome.caseIds.length === 0) throw new Error(`missing acceptance case: ${outcome.id}`);
    for (const caseId of outcome.caseIds) {
      const acceptanceCase = cases.get(caseId);
      if (acceptanceCase?.owner !== outcome.owner || acceptanceCase.outcome !== outcome.id) {
        throw new Error(`missing acceptance case: ${outcome.id}/${caseId}`);
      }
    }
    if (!sameSet(outcome.caseIds.map((caseId) => cases.get(caseId)!.mode), ["native", "code"])) {
      throw new Error(`acceptance case modes differ: ${outcome.id}`);
    }
    operations.push(...outcome.operations);
    skills.push(...outcome.skills);
  }
  if (!sameSet(operations, acceptedOperations)) throw new Error("operation catalog differs from the exact 42 tools");
  if (!sameSet(skills, acceptedSkills)) throw new Error("Skill catalog differs from the exact eight Skills");

  const outcomesById = new Map(manifest.outcomes.map((outcome) => [outcome.id, outcome]));
  const indexedOutcomes = new Set<string>();
  for (const safety of manifest.safetyCases) {
    if (indexedOutcomes.has(safety.outcome)) throw new Error(`duplicate safety outcome: ${safety.outcome}`);
    indexedOutcomes.add(safety.outcome);
    const outcome = outcomesById.get(safety.outcome);
    if (outcome === undefined) throw new Error(`unknown safety outcome: ${safety.outcome}`);
    const safetyCaseIds = safety.cases.map(({ id }) => id);
    if (
      new Set(safetyCaseIds).size !== safetyCaseIds.length
      || safetyCaseIds.some((caseId) =>
        cases.get(caseId)?.owner !== outcome.owner
        || !(outcome.caseIds as readonly string[]).includes(caseId))
    ) {
      throw new Error(`safety case owner mismatch: ${safety.outcome}/${safetyCaseIds.join("+")}`);
    }
    const expectedDimensions = EXPECTED_SAFETY_DIMENSIONS.get(safety.outcome);
    const dimensions = safety.cases.flatMap(({ dimensions }) => dimensions);
    if (
      expectedDimensions === undefined
      || !sameSet([...new Set(dimensions)], expectedDimensions)
      || safety.cases.some(({ dimensions: caseDimensions }) => new Set(caseDimensions).size !== caseDimensions.length)
    ) {
      throw new Error(`safety dimensions differ: ${safety.outcome}`);
    }
  }
  if (!sameSet([...indexedOutcomes], [...EXPECTED_SAFETY_DIMENSIONS.keys()])) {
    throw new Error("safety outcome index differs from the applicable outcome set");
  }

  const mechanisms = new Set<string>();
  for (const mechanism of manifest.mechanisms) {
    if (mechanisms.has(mechanism.id) || !ownerSet.has(mechanism.owner) || mechanism.evidence.trim() === "") {
      throw new Error(`invalid mechanism: ${mechanism.id}`);
    }
    mechanisms.add(mechanism.id);
  }
  const paths = new Set<string>();
  let argumentCount = 0;
  let optionCount = 0;
  for (const route of manifest.cliRoutes as readonly MutableManifest["cliRoutes"][number][]) {
    if (paths.has(route.path)) throw new Error(`duplicate CLI route: ${route.path}`);
    paths.add(route.path);
    if (route.kind === "outcome") {
      if (route.outcomes?.length === 0 || route.outcomes?.some((id) => !outcomeIds.has(id))) {
        throw new Error(`unclassified CLI route: ${route.path}`);
      }
    } else if (route.kind === "mechanism") {
      if (route.mechanism === undefined || !mechanisms.has(route.mechanism)) {
        throw new Error(`unclassified CLI route: ${route.path}`);
      }
    } else if (route.kind === "presentation") {
      if (route.evidence?.trim() === "") throw new Error(`unclassified CLI route: ${route.path}`);
    } else {
      throw new Error(`unclassified CLI route: ${route.path}`);
    }
    const fields = [route.arguments ?? [], route.options ?? [], route.mechanismOptions ?? [], route.presentationOptions ?? []];
    argumentCount += route.arguments?.length ?? 0;
    optionCount += fields.slice(1).reduce((total, values) => total + values.length, 0);
    const uniqueFields = new Set(fields.flat());
    if (uniqueFields.size !== fields.flat().length || fields.flat().some((field) => field.trim() === "")) {
      throw new Error(`unclassified or duplicate CLI field: ${route.path}`);
    }
    if (route.results.some((result) => result.trim() === "") || route.presentations?.some((value) => value.trim() === "")) {
      throw new Error(`unclassified CLI result: ${route.path}`);
    }
  }
  if (paths.size !== manifest.cliSurfaceTotals.commands) throw new Error("CLI command total differs from the frozen surface");
  if (argumentCount !== manifest.cliSurfaceTotals.arguments) throw new Error("CLI argument total differs from the frozen surface");
  if (optionCount !== manifest.cliSurfaceTotals.options) throw new Error("CLI option total differs from the frozen surface");

  const acceptedOperationsByOwner = manifest.outcomes.flatMap((outcome) =>
    outcome.operations.map((operation) => [operation, outcome.id, outcome.owner] as [string, string, string]))
    .sort(([left], [right]) => left.localeCompare(right));
  if (!sameJson(acceptedOperationsByOwner, acceptedSurface.operations)) {
    throw new Error("accepted operation owner evidence differs");
  }
  const acceptedSkillsByOwner = manifest.outcomes.flatMap((outcome) =>
    outcome.skills.map((skill) => [skill, outcome.id, outcome.owner] as [string, string, string]))
    .sort(([left], [right]) => left.localeCompare(right));
  if (!sameJson(acceptedSkillsByOwner, acceptedSurface.skills)) {
    throw new Error("accepted Skill owner evidence differs");
  }
  const acceptedOutcomes = manifest.outcomes.map(({ id, owner }) => [id, owner] as [string, string])
    .sort(([left], [right]) => left.localeCompare(right));
  if (!sameJson(acceptedOutcomes, acceptedSurface.outcomes)) {
    throw new Error("accepted outcome owner evidence differs");
  }
  const acceptedRunnerCases = manifest.acceptanceCases.map(({ id, mode, outcome, owner }) =>
    [id, outcome, owner, mode] as [string, string, string, "code" | "native"])
    .sort(([left], [right]) => left.localeCompare(right));
  if (!sameJson(acceptedRunnerCases, acceptedSurface.runnerCases)) {
    throw new Error("accepted runner case evidence differs");
  }
  const acceptedSafetyDimensions = manifest.safetyCases.flatMap((safety) =>
    safety.cases.flatMap(({ id, dimensions }) =>
      dimensions.map((dimension) => [id, dimension] as [string, string])))
    .sort(([leftCase, leftDimension], [rightCase, rightDimension]) =>
      leftCase.localeCompare(rightCase) || leftDimension.localeCompare(rightDimension));
  if (!sameJson(acceptedSafetyDimensions, acceptedSurface.safetyDimensions.map(([caseId, dimension]) =>
    [caseId, dimension]))) {
    throw new Error("accepted safety dimension evidence differs");
  }
  for (const [caseId, , file, fullName] of acceptedSurface.safetyDimensions) {
    const acceptanceCase = cases.get(caseId);
    if (
      acceptanceCase === undefined
      || !/^test\/(?:authentication|content-tools|discovery-tools|file-transfer|office-tools|render-tools|space-node|svg-tools|typst-tools)\.test\.ts$/u.test(file)
      || fullName.trim() === ""
      || (acceptanceCase.mode === "code" && !/Code Mode|run_code/u.test(fullName))
      || (acceptanceCase.mode === "native" && /through real Code Mode|installed Code Mode|real run_code/u.test(fullName))
    ) throw new Error(`accepted safety test identity differs: ${caseId}`);
  }
  for (const [key, identity] of REQUIRED_SAFETY_TEST_IDENTITIES) {
    const separator = key.lastIndexOf(":");
    const caseId = key.slice(0, separator);
    const dimension = key.slice(separator + 1);
    const row = acceptedSurface.safetyDimensions.find(([id, safetyDimension]) =>
      id === caseId && safetyDimension === dimension);
    if (row === undefined || !sameJson(row.slice(2), identity)) {
      throw new Error(`required safety test identity differs: ${key}`);
    }
  }
  const acceptedCliForms = manifest.cliRoutes.map(({ path, presentations, results }) =>
    [path, [...results], [...(presentations ?? [])]] as [string, string[], string[]]);
  if (!sameJson(acceptedCliForms, acceptedSurface.cliResultForms)) {
    throw new Error("accepted CLI result and presentation evidence differs");
  }
}

function sameJson(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && new Set(actual).size === actual.length
    && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function readFrozenCommanderSurface(): Array<{
  arguments: string[];
  options: string[];
  path: string;
}> {
  return JSON.parse(execFileSync(
    "pnpm",
    ["--filter", "univer-workspace-cli", "inspect:command-surface"],
    {
      cwd: resolve(import.meta.dirname, "../../.."),
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    },
  )) as Array<{ arguments: string[]; options: string[]; path: string }>;
}
