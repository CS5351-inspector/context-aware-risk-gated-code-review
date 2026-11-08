# F evaluation toolkit v0.2

**Status: executable evaluation tooling + provisional development data. Not a completed model benchmark.**

This continues `feat/evaluation-mvp` after PR #4 was merged. It uses the contracts and C model-review module integrated by PR #6, without changing A–E production code or taking over their module tests.

| Delivered | Evidence / boundary |
| --- | --- |
| 12 synthetic families / 20 snapshots | 8 buggy roots, 8 fixed controls, 4 clean-only changes; all development/provisional |
| Dataset validator | Source/diff consistency, executable counterexamples, nonmutation where promised, split checks and version-bound human-review records |
| Paired experiment planner / runner | Frozen data and implementation fingerprints, deterministic order, whole-pair budget reservation, raw output checkpoints, failure/unknown accounting |
| C component adapter | Calls real `reviewFiles` and A's `deriveAnalysisStatus`; same public requirement in both conditions; no replacement parser/risk/gate/retriever |
| Human grading and statistics | Blind packets, atomic findings, root-cause deduplication, novel/unknown handling, per-trial micro/macro metrics, paired family bootstrap |
| Reproduction package | CLI, schemas, protocol, annotation guide, adapter contract, self-checks and saved offline control evidence |

**Not yet delivered by this PR:** independent human gold sign-off, licensed real-PR evaluation data, independent heldout measurements, live model results, actual B retrieval implementation, final product reporting/gate results, human-efficiency results. These require the corresponding people/components; this PR never fabricates them. D/E work does not block data/scorer development.

## Quick start: offline, no key or external model

Use Node 24 (project CI); dataset scripts require Node 18.17+. Install the project's locked dependencies to build the bridge:

```sh
npm ci
npm run test:evaluation
node evaluation/cli.cjs plan --config evaluation/config/offline.json --out evaluation/runs/demo-plan.json
node evaluation/cli.cjs run --plan evaluation/runs/demo-plan.json --out evaluation/runs/demo
node evaluation/cli.cjs labels --runs evaluation/runs/demo --out evaluation/runs/demo/labels.json
node evaluation/cli.cjs score --runs evaluation/runs/demo --labels evaluation/runs/demo/labels.json --out evaluation/runs/demo/summary
```

Use fresh output names: the CLI refuses to overwrite run directories and evidence files. Rebuild with `node evaluation/build-adapter.cjs` and regenerate the plan after changing implementation/config/data. The planner hashes source files and dependencies as well as data, so an uncommitted source change is still pinned. `code_sha` identifies the Git baseline; `implementation_sha256` identifies exact evaluated source content. Runtime bundles are ignored and have their own receipt.

The default adapter is a **scripted no-finding control**, not an LLM. It passes provider-shaped responses through the real C module. Therefore its buggy-case recall should be 0 and its clean controls should succeed; these are plumbing observations, not model quality. Every summary is marked `PLUMBING_CONTROL_NOT_MODEL_EVIDENCE`. Unknown costs remain null on worker failure.

The existing commands remain available:

```sh
node evaluation/validate.cjs
node evaluation/export-input.cjs DEV-001 B1
node evaluation/export-input.cjs DEV-001 B2-oracle
```

The exporter deliberately rejects B2. Only the experiment bridge with an explicitly supplied real B `collectContext` adapter can use B2. All source context is labelled **B2-oracle** when supplied in full.

## Dataset and limitations

| Family | Snapshots | Role |
| --- | --- | --- |
| grant-enum | DEV-001 / 002 | Cross-file enum versus boolean contract |
| scheduler-units | DEV-003 / 004 | Cross-file seconds/milliseconds contract |
| zero-limit | DEV-005 / 006 | Valid zero versus default value |
| index-boundary | DEV-007 / 008 | Array upper-bound check |
| active-users | DEV-009 | Clean filter/map equivalence |
| invoice-reduce | DEV-010 | Clean accumulation equivalence |
| tenant-cache-key | DEV-011 / 012 | Cross-file positional tenant/user key |
| range-end-contract | DEV-013 / 014 | Cross-file inclusive range endpoint |
| numeric-priority | DEV-015 / 016 | Numeric comparator removed |
| cached-false | DEV-017 / 018 | Cache membership versus truthiness |
| copy-reverse | DEV-019 | Clean copy-before-reverse, including nonmutation |
| own-key-filter | DEV-020 | Clean own-key/null filtering |

For each two-case family the first is buggy and the second fixed. This mapping is researcher metadata and is not given to the reviewing model. There are 113 behavioral check executions, including 17 deliberately expected contract violations across 8 buggy snapshots. These are not 17 independent bugs. Inputs are small, synthetic, and often make the requirement obvious; they support tool development, not real-repository generalization. Context necessity and severity remain provisional hypotheses.

The new cases are independently AI-assisted authored under the repository ISC license; no external project source was copied. Existing authorship and A's additional integrity checks are retained. The peer's 55 reliability scenarios remain in `test/fixtures/`; they are not our quality benchmark, not copied or counted here, and their module tests remain with the respective owners. Historical review gaps were addressed in A's integration; do not reopen old issues without checking current evidence.

## Human workflow

1. Read [annotation guide](docs/ANNOTATION.md). Generate a review-record template with `review-template`; two humans independently review requirements, proofs, clean controls, severity and context necessity.
2. Until review is complete, leave labels provisional. Reviewed family upgrades are atomic and require current content digests; validators reject stale sign-offs and unreviewed heldout entries.
3. Configure and run a small live component pilot only when A/B/C inputs and budget are ready; see [adapter contract](docs/ADAPTERS.md). Freeze a new protocol and new family-separated reviewed data for a formal comparison.
4. Use blind review packets, then score:

```sh
node evaluation/cli.cjs blind --runs evaluation/runs/demo --out evaluation/runs/blind-demo
# Share ONLY blind-demo/review/ with graders. Keep private/ and runs/ private from them.
# Humans fill reviewer, reviewed_at and per-claim annotations in review/packets.json.
node evaluation/cli.cjs unblind --mapping evaluation/runs/blind-demo/private/mapping.json --packets evaluation/runs/blind-demo/review/packets.json --out evaluation/runs/demo/adjudicated.json
node evaluation/cli.cjs score --runs evaluation/runs/demo --labels evaluation/runs/demo/adjudicated.json --out evaluation/runs/demo/adjudicated-summary
```

No LLM judge is enabled. The `labels` shortcut is for tool development; it exposes condition names and is not a blind-review procedure. Empty annotations remain unresolved, not automatic false positives. Case/gold review and output adjudication are separate activities.

## Scope and safety of reproduction

- Evaluation output is **C component validated findings**, not E's final user-visible report. Formal component results must retain that label; final product claims require a separately agreed final-output adapter.
- Head source is allow-listed; the read port refuses base/sibling/gold paths. Client prompts contain patch, public requirement and allowed snippets only. Full dataset metadata is not spread into model input.
- Provider modules are trusted local code, **not OS-sandboxed**. They must not load sibling datasets or gold. Do not give a tool-using agent the whole checkout. The worker only enforces a process timeout, not filesystem/network containment.
- Behavioral proofs execute only these trusted local synthetic snippets in temporary CommonJS folders. They are not a sandbox for downloaded third-party code.
- Local provider modules and `runs/` are ignored. Review raw responses and metadata before explicitly publishing experimental evidence; never commit credentials.
- Team workflow: normal commits on `feat/evaluation-mvp`, push that branch, new follow-up PR because #4 is merged; review before merge, no direct main push.

See [protocol](docs/PROTOCOL.md), [current handoff](docs/HANDOFF.md), and [verification report](reports/VERIFICATION.md). JSON schemas describe exchange formats; runtime validation in `validate.cjs` and `lib/` additionally enforces cross-file and statistical invariants.
