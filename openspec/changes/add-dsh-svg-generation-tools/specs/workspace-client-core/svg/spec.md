## ADDED Requirements

### Requirement: Optional SVG local-root and byte controls

Workspace Client Core SHALL let a Node-hosted Client Shell optionally supply one canonical local root, a source-byte limit and an aggregate asset-byte limit to SVG compilation; MUST open and bounded-read each source/asset from one validated regular-file identity; and MUST preserve existing behavior when callers omit the optional controls.

#### Scenario: Source and assets remain inside a supplied root

- **WHEN** the canonical source and every compiler-requested local asset real identity remain under the supplied root and within byte limits
- **THEN** Core reads them through the existing SVG compile workflow and returns the same code, viewport, text-measure, warnings and lints

#### Scenario: Validated path identity changes before read

- **WHEN** source or asset path replacement or symlink change makes the opened file identity differ from the canonical identity that passed root validation
- **THEN** Core fails before consuming that file, starts no later read/wrapper/apply step and does not reopen an alternate identity

#### Scenario: Source escapes a supplied root

- **WHEN** source real identity lies outside the supplied canonical root
- **THEN** Core returns `workspace-svg-input-outside-root` before reading source or starting compiler/browser work

#### Scenario: Asset escapes a supplied root

- **WHEN** an absolute, parent-traversal, `file://` or symlinked compiler-requested asset resolves outside the supplied root
- **THEN** Core returns `workspace-svg-input-outside-root` before reading that asset and starts no later asset, wrapper or apply step

#### Scenario: Source exceeds caller limit

- **WHEN** source size exceeds a supplied positive source-byte limit
- **THEN** Core reads at most the remaining limit plus one byte from the already-opened descriptor, returns the fixed SVG limit outcome before decoding or compiling it and never performs an unbounded whole-file read

#### Scenario: Aggregate assets exceed caller limit

- **WHEN** the next compiler-requested local asset would make total asset bytes exceed the supplied aggregate limit
- **THEN** Core reads at most the remaining aggregate allowance plus one byte from the already-opened descriptor, counts actual bytes read, returns the fixed SVG limit outcome and starts no later asset or apply step

#### Scenario: File changes size after opening

- **WHEN** an opened regular file grows, shrinks or is replaced while the bounded reader is active
- **THEN** the reader consumes only the opened descriptor, uses actual bytes for its limit/aggregate result, detects overrun with the one-byte probe and never switches to a path-based unbounded read

#### Scenario: Workspace CLI omits local controls

- **WHEN** Workspace CLI calls SVG compile without a local root or byte limits
- **THEN** the same opened-descriptor reader uses the validated regular-file size plus one as its per-read bound and source/relative-asset results, errors and command behavior remain compatible

### Requirement: SVG compile and measurement cancellation

Workspace Client Core MUST accept an optional `AbortSignal` for SVG compilation, MUST check it around every separable source, asset, compiler, page-wrapper and text-measure step, and MUST await browser runtime close before the operation settles.

#### Scenario: Cancellation precedes source read

- **WHEN** a supplied signal is aborted before source work starts
- **THEN** no source, asset, compiler or browser work starts

#### Scenario: Cancellation precedes an asset read

- **WHEN** the signal aborts after source parsing but before the next compiler-requested asset read
- **THEN** Core reads no later asset and returns no partial compile result

#### Scenario: Compiler or measurement cannot be interrupted

- **WHEN** cancellation arrives during a frozen compiler or browser measurement operation without a signal input
- **THEN** Core awaits that operation, observes cancellation immediately afterward, starts no later wrapper/apply step and returns no compile success

#### Scenario: Browser runtime was created

- **WHEN** success, compiler failure, measurement failure or cancellation follows real text measurement
- **THEN** Core closes the one runtime before settling and does not let cancellation skip cleanup

#### Scenario: Estimation is selected

- **WHEN** estimation is explicitly selected with a non-aborted signal
- **THEN** no browser starts and existing deterministic compile/lint behavior is preserved

#### Scenario: Existing caller omits a signal

- **WHEN** Workspace CLI compiles the same SVG without a signal
- **THEN** lazy runtime creation, line measurement, close timing, page wrapping and compile outcomes remain unchanged

### Requirement: Cancellation-aware SVG apply through shared content execution

Workspace Client Core SHALL let a Client Shell supply the optional signal and existing canonical-value limits when applying a compiled SVG page, MUST forward them to shared Slide content execution, and MUST preserve its Draft authority, commit uncertainty and no-replay behavior.

#### Scenario: Cancellation precedes apply

- **WHEN** the signal aborts before shared Slide execution begins
- **THEN** Core starts no target resolution, worker execution, embedded-image upload or changeset commit

#### Scenario: Apply returns a confirmed result

- **WHEN** shared Slide execution confirms a no-mutation result or revision before observing cancellation
- **THEN** Core may return the existing apply envelope without recompiling or executing the page program again

#### Scenario: Apply becomes partial or unknown

- **WHEN** shared execution reports confirmed embedded-image side effects or an uncertain dispatched commit
- **THEN** Core preserves `workspace-content-partial-side-effect` or `workspace-result-unknown`, starts no later attempt after cancellation and never recompiles or replays the page program

#### Scenario: Apply value exceeds caller limits

- **WHEN** the execution value is non-lossless or exceeds supplied byte/depth limits
- **THEN** the shared pre-commit value gate fails before embedded-image upload, mutation replacement or commit

#### Scenario: Existing CLI apply omits optional controls

- **WHEN** Workspace CLI applies a compiled page without signal or value limits
- **THEN** Slide-only target validation, generated program identity, no-mutation/confirmed revision results, errors and installed command behavior remain unchanged

### Requirement: Workspace CLI SVG compatibility after optional controls

Workspace CLI MUST retain its `compile-svg` arguments, local source/asset behavior, raw/page code, real/estimated text measurement, `--out` ordering, warnings/lints, structured/text output, apply results, errors and installed artifact behavior after Client Core adds the optional controls.

#### Scenario: Existing CLI SVG tests run

- **WHEN** CLI command, Core compiler, text-measure and Worktree apply cases run without DSH-only options
- **THEN** source paths, generated code, viewport, page/mode, diagnostics, output files, runtime options, commit results and failures remain compatible

#### Scenario: Installed CLI artifact runs from another cwd

- **WHEN** the existing CLI package smoke compiles an SVG from an arbitrary working directory
- **THEN** its worker, render page, browser dependencies, SVG compiler and current output behavior resolve without a DSH package or source-checkout dependency
