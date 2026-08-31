## Purpose

定义 `dsh-univer-work` 对 Trunk 或 Worktree Unit 的结构化内容检查、对 Draft Worktree Unit 的 Facade execution，以及 Draft isolation、worker lifecycle、错误、取消和安装态交付行为。

## ADDED Requirements

### Requirement: Structured Workspace content inspection

The Client Shell SHALL expose one `workspace_content_inspect` DSH tool that selects a Trunk or Worktree Unit, accepts the published structured inspection queries, and returns the corresponding lossless validated content result without accepting arbitrary read code.

#### Scenario: Trunk content is inspected

- **WHEN** the tool receives a non-empty `unit_id`, `scope: trunk`, no `worktree_id`, and a query supported by that Unit type
- **THEN** it resolves the authoritative Trunk Unit type and current revision and returns the exact structured inspection result for that Unit

#### Scenario: Worktree content is inspected

- **WHEN** the tool receives a non-empty `unit_id`, `scope: worktree`, a non-empty `worktree_id`, and a supported query
- **THEN** it reads the selected Worktree Unit at its current Draft revision without reading or changing Trunk

#### Scenario: Published inspection queries are supplied

- **WHEN** a caller selects `workbook`, `worksheet`, `worksheet-range`, `presentation`, `slide`, `document`, or `paragraph`
- **THEN** the query accepts only its exact structured selectors or ranges, uses non-negative zero-based indices, and returns the matching result discriminant
- **AND** Sheet queries run only for Sheet, presentation/slide only for Slide, and document/paragraph only for Doc

#### Scenario: Inspection input exceeds a frozen limit

- **WHEN** one complete canonical argument exceeds `524,288` UTF-8 JSON bytes, one query contains more than `64` selectors/ranges, a grammar-valid A1 rectangle has unsafe area arithmetic, or safe requested cells sum above `100,000`
- **THEN** pure runtime validation fails with `workspace-content-limit-exceeded` and exact `{ kind, limit, actual? }` detail before authenticated target resolution or worker startup, omitting `actual` only when safe arithmetic cannot represent it
- **AND** no partial or truncated inspection is returned

#### Scenario: Inspection contains a huge string argument

- **WHEN** a single Unit/Worktree ID, selector id/name, range literal or their combined canonical argument exceeds the `524,288` byte call budget
- **THEN** the plugin rejects it before authenticated work without copying the rejected raw value into failure detail
- **AND** the pre-existing DSH-owned caller argument record remains governed by rc.2

#### Scenario: Worksheet A1 syntax is malformed

- **WHEN** a range is empty, does not match the published beta.2 cell-A1 grammar, uses row zero, or reverses its start/end cell
- **THEN** pure validation returns `INSPECTION_SELECTOR_INVALID` with fixed text and no raw range detail rather than classifying it as a size limit

#### Scenario: Worksheet A1 area overflows safely

- **WHEN** a range matches the published grammar but column/row/area arithmetic is not safely representable or its safe area makes the total exceed `100,000` cells
- **THEN** pure validation returns `workspace-content-limit-exceeded` with kind `worksheet-cells` before worker work

#### Scenario: Target scope fields conflict

- **WHEN** Trunk includes `worktree_id`, Worktree omits it, or the caller supplies revision, Unit type, origin, code, credential, or another undeclared field
- **THEN** the tool fails with stable invalid-argument information before authenticated target resolution or worker startup

#### Scenario: Inspection selector is invalid

- **WHEN** a selector is empty, ambiguous, missing, out of bounds, or incompatible with the selected Unit
- **THEN** the tool preserves the applicable stable inspection code and returns no partial inspection result

### Requirement: Draft Facade execution

The Client Shell SHALL expose one `workspace_content_execute` DSH tool that executes inline Facade code only against an authoritative Draft Worktree Unit and returns a confirmed no-mutation or committed result.

#### Scenario: Execution captures no mutations

- **WHEN** code completes against the selected Draft Worktree Unit without captured mutations
- **THEN** the tool returns `{ committed: false, value }` with the lossless JSON value and does not submit a changeset

#### Scenario: Execution commits captured mutations

- **WHEN** code captures supported mutations and the same pending changeset is confirmed
- **THEN** the tool returns `{ committed: true, revision, status: 'committed', value }` only for the confirmed Worktree Unit revision
- **AND** it does not execute the Facade code a second time

#### Scenario: Non-editable content is selected

- **WHEN** execution identifies Trunk, a ready/merged/discarded Worktree, a Unit outside the selected Worktree, or another non-Draft target
- **THEN** it fails with the applicable stable target, lifecycle, or Unit error before write-mode code runs

#### Scenario: Facade program is invalid

- **WHEN** code is empty, syntactically invalid, conflicts with a reserved binding, or does not satisfy the selected Unit type
- **THEN** the tool fails with stable argument or content-execution information and does not report a commit

#### Scenario: Facade program exceeds the code budget

- **WHEN** the UTF-8 encoding of `code` exceeds `262,144` bytes
- **THEN** the shared pure body validator fails with `workspace-content-limit-exceeded` before credential resolution or worker execution

#### Scenario: Execute arguments exceed the call budget

- **WHEN** a single `unit_id`/`worktree_id` or the complete execute argument exceeds `524,288` canonical UTF-8 JSON bytes
- **THEN** the shared pure body validator fails with `workspace-content-limit-exceeded` before credential resolution without copying the raw rejected argument
- **AND** this gate does not claim to remove the DSH-owned record created before policy

#### Scenario: Execute value exceeds the side-effect-safe budget

- **WHEN** write-mode execution produces a non-JSON value, a value deeper than `64`, or canonical JSON larger than `8,388,000` UTF-8 bytes
- **THEN** Client Core fails with the stable content limit/result code before embedded-image upload, mutation replacement or changeset commit
- **AND** the shell does not convert an already dispatched content mutation into an ordinary size failure

#### Scenario: Caller requests a file-backed script or target authority

- **WHEN** a direct call includes `script`, local path, Unit type, revision, origin, runtime target, cookie, license, password, command, or another undeclared field
- **THEN** the closed tool rejects it without reading a file, credential, or Workspace state

### Requirement: Closed content schemas and application-validated values

Both content tools MUST expose closed parameter schemas and an honest non-recursive DSH output projection, MUST apply exact own-key and cross-field validation at runtime, and MUST apply application-owned complete canonical validation and frozen byte/depth limits before rendering or returning a value to Native or Code Mode.

#### Scenario: Tool catalog is assembled

- **WHEN** DSH assembles Native schemas or the Code Mode SDK
- **THEN** it exposes exactly `workspace_content_inspect` and `workspace_content_execute` for this Change with root `additionalProperties: false`
- **AND** inspection declares the seven exact query variants and execute declares only `worktree_id`, `unit_id`, and `code`

#### Scenario: Direct execution supplies an unknown key

- **WHEN** either tool receives an own key outside its declaration or a wrong primitive/container type
- **THEN** it fails with fixed `workspace-argument-invalid` information before credential, license, target HTTP, worker, or content work
- **AND** plugin-owned failure content does not echo the key or value

#### Scenario: Inspection value is returned

- **WHEN** inspection succeeds
- **THEN** an application-owned validator has checked one complete result discriminant for workbook, worksheet, worksheet-range, presentation, slide, document, or paragraph, including exact nested keys, query/result compatibility, requested Unit identity, JSON leaves and recursive Slide children through depth `64`
- **AND** the DSH schema projects recursive `SlideElementInspection.children` as `JsonValue` because rc.2 cannot express `$ref` or recursion, without claiming that `output.schema` or published `inspectContent()` alone performs the complete validation

#### Scenario: Execute value is returned

- **WHEN** execution succeeds
- **THEN** its canonical outer object contains only the applicable committed, revision, status, and lossless JSON value fields
- **AND** its JSON depth is at most `64`, its complete canonical UTF-8 JSON is at most `8,388,608` bytes, Native rendering presents that complete validated value, and Code Mode receives the same canonical value

#### Scenario: Canonical output is malformed

- **WHEN** a body produces a missing discriminant, an unknown field at any depth, non-JSON value, wrong Unit identity, invalid revision/status, result incompatible with the selected query, or recursive value deeper than `64`
- **THEN** application validation rejects it before DSH rendering or programmatic return

#### Scenario: Canonical output exceeds its byte limit

- **WHEN** a complete inspect or execute canonical value would exceed `8,388,608` UTF-8 JSON bytes
- **THEN** the tool fails with `workspace-content-limit-exceeded` and exact safe limit detail rather than returning a truncated success, partial value, spill handle, or alternate canonical shape

#### Scenario: Deep Slide groups are validated

- **WHEN** inspection returns a valid nested Slide group within depth `64`
- **THEN** the application accepts every recursively valid child even though DSH uses a non-recursive projection
- **AND** it rejects a malformed or unknown key in any deep child and rejects depth `65`

### Requirement: Draft content execution does not request approval

The Client Shell MUST validate every pure execute argument constraint in the tool body before credential or runtime work, MUST execute only against an authoritative Draft Worktree Unit, and MUST request no DSH approval for inspection or execute.

#### Scenario: Invalid or oversized execution fails before runtime work

- **WHEN** execute has an unknown key, non-string or blank `worktree_id`, `unit_id`, or `code`, total arguments over `524,288` canonical bytes, or code over `262,144` UTF-8 bytes
- **THEN** the body validator fails with fixed `workspace-argument-invalid` or `workspace-content-limit-exceeded` metadata and no approval interaction/event, credential read, Workspace request, or worker startup occurs

#### Scenario: Valid Draft execution does not ask

- **WHEN** pure execute validation succeeds
- **THEN** the body resolves authoritative target editability and program rules without creating an approval interaction or event
- **AND** Facade code runs only after the target is confirmed as the selected Draft Worktree Unit

#### Scenario: Non-Draft execution fails closed

- **WHEN** authoritative resolution finds Trunk, a non-Draft Worktree, or a Unit outside the selected Worktree
- **THEN** no write-mode Facade code, image upload, mutation replacement, or commit starts

#### Scenario: DSH-owned arguments are inspected

- **WHEN** Native or Code Mode calls execute
- **THEN** Native `tool/call.arguments`, or Code Mode `tool/code-dispatch-start.arguments` and settled `tool/code-dispatch.arguments = normalized.logged`, retain the original code and IDs according to DSH rc.2
- **AND** plugin-owned lifecycle payloads do not copy them, while result/failure/finalizer never copy code, credential/license, rejected raw arguments, selector id/name or arbitrary query values
- **AND** only a recognized outcome/error may project its frozen validated public Worktree/Unit target, numeric selector kind/index or canonical A1 identity

#### Scenario: Argument transcript contains different sentinel classes

- **WHEN** transcript fixtures include caller-code that the program does not itself return, credential/license, rejected raw argument and allowlisted public-identity sentinels
- **THEN** the caller-code sentinel remains only in DSH-owned argument records, credential/license and rejected raw sentinels never enter plugin-owned content, and allowlisted public identity appears only where a recognized result or exact safe error projection requires it

### Requirement: Current credential, license, and worker ownership

The Client Shell MUST run content operations through a package-relative worker with the current authenticated Workspace grant and a non-empty application runtime license, and MUST retire a pooled runtime when that grant changes.

#### Scenario: Content runtime starts

- **WHEN** an accepted operation first needs a worker
- **THEN** the Host supplies the exact authenticated origin/cookie, non-empty `UNIVER_LICENSE` override or synchronized application-owned default, and packaged worker entry directly to the content runtime
- **AND** no credential or license enters a tool argument, canonical value, rendering, ordinary Config, or Session event

#### Scenario: Authentication is unavailable

- **WHEN** the current record is absent, pending, malformed, deleted, or for another origin
- **THEN** the operation fails with `workspace-authentication-required` or the applicable sanitized credential error before a worker receives content

#### Scenario: License is unavailable

- **WHEN** neither a valid application default nor a non-empty override can be supplied
- **THEN** the operation fails with `workspace-license-required` without exposing the rejected value

#### Scenario: Authenticated grant changes

- **WHEN** the plugin-owned credential record is replaced or deleted while a runtime generation exists
- **THEN** the Host retires and closes that generation and a later accepted operation creates a new generation from the then-current record
- **AND** no later operation reuses the prior Login Session cookie

#### Scenario: Runtime owner closes

- **WHEN** its credential changes or the Host disposes
- **THEN** the worker pool, worker process, leases and pending operations settle before generation close completes

### Requirement: Content failure fidelity and secrecy

The Client Shell MUST preserve only frozen allowlisted Workspace HTTP/source, inspection, content-execution, collaboration-runtime and collaboration-pool codes with exact safe detail, and MUST map every unlisted or unsafe dependency failure to `workspace-content-operation-failed` with fixed operation text.

#### Scenario: Recognized inspection or execution error crosses the boundary

- **WHEN** content work raises an allowlisted target, authentication, license, inspection, execution, runtime, collaboration-pool, result-mismatch, result-unknown, partial-side-effect, bounded-submit, or Server code
- **THEN** the failure metadata retains that code and a fixed operation message
- **AND** detail includes only validated canonical public target, Unit type, revision, numeric selector/canonical A1 range, HTTP status/path, limit kind/count, confirmed-upload/content-commit state, commit status, or changeset identity fields

#### Scenario: Shared HTTP or collaboration failure crosses the boundary

- **WHEN** Core raises `workspace-invalid-response`, `workspace-origin-mismatch`, `workspace-request-invalid`, or `workspace-redirect-refused`, or the SDK raises `COLLABORATION_INVALID_INPUT`, `COLLABORATION_LOAD_FAILED`, `COLLABORATION_UNAVAILABLE`, `COLLABORATION_PROTOCOL_ERROR`, or `COLLABORATION_CLOSED`
- **THEN** the adapter preserves that exact allowlisted code with fixed text and its code-specific safe detail projection
- **AND** representative source, collaboration-runtime and collaboration-pool cases are verified with secret sentinels

#### Scenario: Write outcome carries identity

- **WHEN** Core reports a confirmed or result-unknown dispatched write
- **THEN** revision, `sid`, `reqId` and target identity used by the shell come only from Core's structured result/error detail
- **AND** the shell does not parse any identity from an original error message

#### Scenario: Error contains unsafe material

- **WHEN** an error message, cause, stack, unallowlisted detail, worker init, response header, Facade exception, cell value, code string, cookie, license, rejected raw argument or grant payload contains a sentinel
- **THEN** the tool omits that material and returns a fixed sanitized failure, without removing a separately validated canonical public identity owned by the recognized outcome

#### Scenario: Successful content contains authorized values

- **WHEN** inspection or execute intentionally returns Workspace content as its successful canonical value
- **THEN** the value remains lossless and is not treated as an error secret merely because it contains user-authored content

### Requirement: Cancellation, uncertain commit, and Host lifecycle

Every content tool MUST fuse caller and Host-owner cancellation, pass it through every supported target/runtime step, wait for uninterruptible worker work to settle, and leave no accepted body or runtime generation after Host disposal.

#### Scenario: Caller cancels before body dispatch

- **WHEN** the original caller signal aborts before ToolRuntime invokes a body
- **THEN** DSH returns `ABORTED_BEFORE_DISPATCH` and no plugin validator body, resolver, worker, or Workspace request runs

#### Scenario: Inspection is cancelled during worker work

- **WHEN** caller cancellation or owner disposal occurs after inspection enters a worker operation that the frozen runtime pool cannot interrupt
- **THEN** the Host waits for that operation to settle, starts no later content step, returns no partial inspection value, and classifies caller cancellation or owner disposal without abandoning worker work

#### Scenario: Execute is cancelled before a remote mutation

- **WHEN** cancellation is observed before an embedded-image upload or changeset commit may dispatch
- **THEN** no remote mutation begins, no later execute step starts, and the unconfirmed worker lease is cleaned or invalidated before settlement

#### Scenario: Image upload may have dispatched

- **WHEN** cancellation aborts an embedded-image upload after its POST may have reached Workspace
- **THEN** execution stops before later uploads or changeset commit and preserves `workspace-result-unknown` rather than silently using best-effort fallback
- **AND** DSH preserves that thrown tool-owned structured error rather than replacing it with `ABORTED`

#### Scenario: A prior image upload confirmed before caller cancellation

- **WHEN** one embedded-image upload is confirmed and original caller cancellation becomes visible before the next upload, mutation replacement or first commit
- **THEN** Core records `workspace-content-partial-side-effect` with confirmed upload count, `contentCommitted: false` and authoritative target, invalidates the dirty lease, and starts no next upload, replacement or commit
- **AND** DSH preserves that thrown partial-side-effect code; fixed final guidance keeps its registry identity, says the confirmed upload may be an unreferenced orphan, requires Worktree inspection before a deliberate retry, and does not replay code or re-upload images

#### Scenario: A prior image upload confirmed before owner disposal

- **WHEN** one embedded-image upload is confirmed and only the Host-owner signal aborts before the next upload, replacement or first commit
- **THEN** owner-cancellation mapping preserves structured `workspace-content-partial-side-effect` for the accepted live caller while disposal awaits lease invalidation, accepted-body settlement and runtime close
- **AND** the Host performs no compensating File API delete, next upload, replacement, commit, code replay or image re-externalization

#### Scenario: Commit becomes unknown after confirmed uploads

- **WHEN** image uploads confirmed, mutation replacement completed and a commit may have dispatched before cancellation or an unknown response
- **THEN** `workspace-result-unknown` with structured changeset/target identity takes precedence over the earlier upload state
- **AND** DSH preserves that thrown tool-owned error and no image upload, replacement, Facade execution or changeset is replayed

#### Scenario: Commit asks for retry while cancellation arrives

- **WHEN** a commit returns retry or unknown and the fused signal aborts before another attempt
- **THEN** no next commit starts, Facade code is never replayed, and the tool preserves `workspace-result-unknown` with only safe target/changeset identity
- **AND** DSH does not replace that thrown tool-owned error with `ABORTED`

#### Scenario: Commit confirms after caller cancellation

- **WHEN** Core confirms a revision after or concurrently with original caller cancellation
- **THEN** the body returns success and DSH rc.2 returns canonical `ABORTED` instead of that late success
- **AND** final content preserves that error identity and instructs Worktree get/content inspection before deciding whether to retry

#### Scenario: Owner-only disposal races with confirmed commit

- **WHEN** only the Host-owner signal aborts and the commit has already been confirmed
- **THEN** the accepted body may return confirmed success while disposal drains it
- **AND** an unconfirmed write remains unknown and is not replayed

#### Scenario: Host disposes the capability

- **WHEN** the owning fiber disposes with tools, credential rotation, target HTTP, worker execution, image upload, commit, runtime close, or result finalization active
- **THEN** it rejects and unregisters new calls, aborts owner-controlled work, closes the current runtime generation, and waits for every accepted body and close operation
- **AND** no tool, listener, worker, lease, request, retry, timer, Job, daemon, cached content result, or detached task survives disposal

### Requirement: Installed worker-backed content capability

The prebuilt tarball MUST include the Host and content worker code, the collaboration runtime child and every declared runtime dependency required to execute both tools outside the monorepo checkout.

#### Scenario: Packed artifact is inspected

- **WHEN** package verification inspects emitted entries, chunks, manifest dependencies and files
- **THEN** every package-relative worker and runtime-child reference resolves inside the tarball
- **AND** the build has resolved the exact `@univerjs-pro/engine-formula-rust-binding` version from the installed `@univerjs-pro/engine-formula-rust` owner manifest, externalized and declared/copied that exact native package, and defined `__UNIVER_RUST_FORMULA_LOCAL_BINDING_FALLBACKS__ = false`
- **AND** no bare private Core/workspace dependency, CLI source, daemon, Session file, absolute checkout/source path, adjacent checkout fallback, Web Client, render page, Office/generation native resource, or future capability is included

#### Scenario: Installed inspection and execution run

- **WHEN** an isolated local profile installs the tarball, changes to an unrelated temporary cwd with no workspace `node_modules` or source fallback, and uses real DSH ToolRuntime plus emitted `worker.js`, colocated `worker-child.mjs`, exact formula binding and packaged license/credential resolvers against a keyless fake Workspace/Collaboration service
- **THEN** Trunk/Worktree inspection and no-mutation/confirmed execute return the same closed schemas and canonical outcomes as source composition
- **AND** cancellation, unknown commit, credential-generation replacement and normal disposal settle without a real account or model credential

#### Scenario: Installed transcript is inspected

- **WHEN** Native and Code Mode installed calls contain a caller-code sentinel that the program does not return, credential, license, rejected-argument, dependency-error and allowlisted-identity sentinels
- **THEN** that code sentinel appears only in DSH-owned caller argument records, credential/license/rejected/error sentinels appear in no plugin-owned model-visible content, and an allowlisted identity appears only in the recognized canonical outcome or exact safe detail that owns it
