# F evaluation toolkit v0.2

**Reviewed Bailian comparison:** the 6-case pilot and 20-case paired development experiment are complete (52 real calls), and the user has confirmed all output-grading suggestions. See the [final report](reports/bailian-2026-11-22/README.md), [reviewed metrics](reports/bailian-2026-11-22/development/summary-reviewed/summary.json) and frozen raw receipts. Both conditions use `deepseek-v4.1-flash-1017` on Bailian, with native CNY estimates. Two judgments remain unresolved as explicitly accepted by the user, so precision is reported as bounds. This is a reviewed exploratory development comparison, not formal heldout evidence or a replay of RelayCore results.

**Status: reviewed development data, completed live comparison and human-confirmed output judgments. Formal heldout benchmarking remains outside this run.**

**Sprint2 preparation (2026-11-22):** the [Chinese case review packet](review-packet/README.md) records the completed 20-case review; the [execution checklist](docs/SPRINT2_EXECUTION.md) links the subsequent live experiment. The [RelayCore preparation adapter](docs/SPRINT2_ADAPTER.md) and [Bailian adapter](docs/BAILIAN_COMPARISON.md) connect merged B/C implementations. Offline integration checks use scripted responses; the archived Bailian experiment uses actual model responses. Pricing and budget are frozen, and live output grading has been confirmed. The single-person review policy retains acceptance and content-bound evidence without reviewer identity or review date. Reviewed development data is not independent heldout data.

This continues `feat/evaluation-mvp` after PR #4 and PR #7 were merged. It connects the merged B/C implementations through an evaluation adapter, without taking over A–E production responsibilities or module tests.

| Delivered | Evidence / boundary |
| --- | --- |
| 12 synthetic families / 20 snapshots | 8 buggy roots, 8 fixed controls, 4 clean-only changes; all development/reviewed |
| Dataset validator | Source/diff consistency, executable counterexamples, nonmutation where promised, split checks and version-bound human-review records |
| Paired experiment planner / runner | Frozen data and implementation fingerprints, deterministic order, whole-pair budget reservation, raw output checkpoints, failure/unknown accounting |
| C component adapter | Calls real `reviewFiles` and A's `deriveAnalysisStatus`; same public requirement in both conditions; no replacement parser/risk/gate/retriever |
| Human grading and statistics | Blind packets, atomic findings, root-cause deduplication, novel/unknown handling, per-trial micro/macro metrics, paired family bootstrap |
| Reproduction package | CLI, schemas, protocol, annotation guide, adapter contract, self-checks and saved offline control evidence |

**Still pending for this evaluation:** account-specific live configuration, live runs over the reviewed dataset, human grading of those model outputs and the resulting measurements. Licensed real-PR data, independent heldout measurements, final-product conclusions and human-efficiency experiments remain separate extensions. The actual B collector and C client are already connected; existing team pilot records do not substitute for this dataset experiment.

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

For each two-case family the first is buggy and the second fixed. This mapping is researcher metadata and is not given to the reviewing model. There are 113 behavioral check executions, including 17 deliberately expected contract violations across 8 buggy snapshots. These are not 17 independent bugs. Inputs are small, synthetic, and often make the requirement obvious; they support tool development, not real-repository generalization. The user accepted the stated severity judgments and their limitations; context necessity remains an empirical question, not a consequence of the cross-file category.

The new cases are independently AI-assisted authored under the repository ISC license; no external project source was copied. Existing authorship and A's additional integrity checks are retained. The peer's 55 reliability scenarios remain in `test/fixtures/`; they are not our quality benchmark, not copied or counted here, and their module tests remain with the respective owners. Historical review gaps were addressed in A's integration; do not reopen old issues without checking current evidence.

## Human workflow

1. Read [annotation guide](docs/ANNOTATION.md). The workflow is **先 AI 生成结果，然后由我人工复核**. One human confirmation is sufficient; record decision and content-bound evidence, without reviewer name or review date. All current 20 cases have been confirmed without changes.
2. Until review is complete, leave labels provisional. Reviewed family upgrades are atomic and require current content digests; validators reject stale sign-offs and unreviewed heldout entries.
3. Configure and run a small live component pilot only when A/B/C inputs and budget are ready; see [adapter contract](docs/ADAPTERS.md). Freeze a new protocol and new family-separated reviewed data for a formal comparison.
4. Use blind review packets, then score:

```sh
node evaluation/cli.cjs blind --runs evaluation/runs/demo --out evaluation/runs/blind-demo
# Share ONLY blind-demo/review/ with graders. Keep private/ and runs/ private from them.
# Fill per-claim annotations and evidence; set review_status to reviewed only after actual human review.
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

The saved `reports/control-v0.2/` and its verification report describe the old provisional dataset fingerprint. Reproduce them from the corresponding historical checkout; do not silently rescore those receipts against the newly reviewed metadata.

See [protocol](docs/PROTOCOL.md), [current handoff](docs/HANDOFF.md), and [Sprint2 preparation verification](reports/sprint2-preparation/VERIFICATION.md). JSON schemas describe exchange formats; runtime validation in `validate.cjs` and `lib/` additionally enforces cross-file and statistical invariants.
