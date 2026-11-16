# D risk assessment and approval gate

## Scope and integration

Implements the existing CalculateRisk and DecideGate ports in src/review/contracts.ts. No dependency or shared-signature changes.

Inject calculateRisk and decideGate as the pipeline risk/gate providers. The pipeline rejects cross-repository PRs before file/model providers run. D cannot infer fork identity from GateContext because that port has no repository fields.

The legacy bot entry point is unchanged. This module does not install branch protection, query GitHub permissions, publish comments/statuses or serialize review events.

## Risk policy

- Evaluate sensitive globs against every changed path and rename source, including excluded/deleted files.
- Preserve HIGH for sensitive paths or retained high findings, including unlocated/unverified high findings.
- Incomplete required analysis is UNKNOWN unless a HIGH factor exists.
- Verified medium findings or configured whole-PR line/file thresholds produce MEDIUM after higher-priority rules.
- Otherwise LOW. NOT_APPLICABLE is not a completed code review.
- Change size counts additions plus deletions and all changed files. Thresholds are configuration inputs, not empirically tuned constants.
- Reject malformed D-consumed fields, duplicate or contradictory scope, and scope that differs from the PR snapshot. Unknown severity must not silently become LOW.
- Coordinate validation is not proof that a model finding is semantically correct.

## Gate policy

- Invalid configuration/input/history gives ERROR; a changed head gives STALE. Human approval cannot override either.
- Qualified unresolved CHANGES_REQUESTED blocks, even for a complete LOW result. It persists across commits until that reviewer approves or the decision is dismissed.
- Complete LOW/MEDIUM may PASS without human approval.
- HIGH/UNKNOWN and incomplete/NOT_APPLICABLE require the configured number of qualified approvals. A human override changes gate state, not risk or analysis status.
- Count unique, case-insensitive, non-author human accounts with current write/maintain/admin permission, and only APPROVED decisions on the reviewed current head.
- COMMENTED preserves the previous decision; DISMISSED clears it. Sort by parsed timestamp, then review ID.
- Reject impossible calendar dates, conflicting actor types and conflicting snapshots of one review ID. Identical duplicate snapshots are idempotent.

## Adapter responsibilities

A must validate network input, supply authoritative current identity/permission information, and normalize current GitHub review snapshots or an ordered decision history. A dismissal update to an existing GitHub review ID must be resolved into one authoritative snapshot before calling D; conflicting records must not be ordered by array position.

Risk and gate must consume the same immutable analysis/config snapshot. A must handle a rejected risk input as an error and must not reuse an earlier passing result. GateContext binds approval decisions to a reviewed/current head; it cannot verify an arbitrary low risk value against a different PR's path configuration by itself.

A still owns same-head review/approval/revocation serialization, publication-time revalidation, failure handling, SHA-bound status publication and required-status demonstration. D pure-function tests do not establish atomic GitHub publication or a deployed production gate.

## Verification

Commands (offline, with existing locked dependencies):

- npm run typecheck
- npm test -- --runInBand
- npm run test:evaluation
- npm run build
- node --check action/index.cjs

test/review/risk-gate.test.ts checks all 55 public reliability cases at the D boundary, with scripted B/C analysis as input, plus independent thresholds/history and pipeline-injection cases.
test/review/risk-gate-boundaries.test.ts checks independently corrupted scope/output, invalid review dates and identity conflicts.
Local result: 12 Jest suites / 420 tests, including 107 D tests; evaluation 43/43; source typecheck and build passed. Existing Rollup external-dependency warnings remain. No dependencies were installed.
These are protocol/reliability tests, not model-accuracy measurements.

No model credentials, deployment workflow, personal demonstration, learning material or model-call evidence is part of this change.
