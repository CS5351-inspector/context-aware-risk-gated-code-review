# Verification — evaluation toolkit v0.2

Date: 2026-11-08. Baseline: merged main `c9b4e40`; feature branch: `feat/evaluation-mvp`. The exact working implementation is additionally captured in the control plan and receipt hashes. This is an engineering verification report, not a live model evaluation report.

## Author-submitted checks (before review follow-ups)

| Check | Result | Scope |
| --- | --- | --- |
| Locked install | Passed `npm ci --ignore-scripts --no-audit --no-fund` | Existing dependency lock; no dependency change |
| Dataset validator | 12 families, 20 snapshots, 8 roots, 113 behavior checks; 17 expected buggy observations | Trusted local synthetic data; not human gold approval |
| Evaluation self-checks | 31/31 passed; details in `test-results.tap` | Integrity, real C bridge, frozen plan, isolation port, grading, paired statistics and CLI |
| Evaluation bridge typecheck | Passed standalone strict TypeScript check | Existing shared C/A types plus evaluation adapter |
| Project typecheck | Passed `npm run typecheck` | Existing production sources |
| Existing project tests | 10 suites / 290 tests passed | No product test changes |
| Build | Passed `npm run build` | Existing build pipeline |
| Action artifact check | `node --check action/index.cjs` and `git diff --exit-code -- action` passed | Generated Action output unchanged |
| Saved control experiment | 40 paired scripted runs through real C: B1 and B2-oracle | No model API, no actual B retrieval, no published GitHub review |

The adapter preflights effective live parameters before any provider request. Missing B, a mismatched configuration, raw tampering, stale annotations, unsupported formal data or insufficient pair budgets fail explicitly. Failed requests are not rewritten as valid empty findings.

## Recompute saved control

```sh
node evaluation/cli.cjs score --runs evaluation/reports/control-v0.2 --labels evaluation/reports/control-v0.2/labels.json --out evaluation/runs/recomputed-control
```

The saved control, receipt and TAP log below preserve the author-submitted snapshot; they were not regenerated or relabelled after review fixes. The updated scorer adds provenance and denominator fields, so a new summary need not match the original JSON byte-for-byte.

The control returns valid empty model-shaped responses. Its expected buggy recall is 0, clean success 1 and precision N/A, with status `PLUMBING_CONTROL_NOT_MODEL_EVIDENCE`. Those values verify tool behavior only; they do not measure a model. Raw results, run records, plan, placeholder labels and summary are saved together.

`receipt.json` hashes the delivered evaluation files and package scripts (excluding itself and ignored build/local-run/provider paths). Historical v0.1 receipts remain in Git history; this receipt describes the author-submitted files, not the later review fixes. Runtime identity is separately pinned by the plan's source/dependency fingerprint and bundled bridge receipt.

No real model invocation, independent human sign-off, real-PR benchmark, final product/gate evaluation, human-time measurement or RQ5 policy experiment was executed. See `../docs/HANDOFF.md` for owners and prerequisites. Remote PR CI status is independent of these local results.

## Follow-up review verification (2026-11-08)

Changes `b653d76` and `19eab11` fix symmetric clean-case reclassification, order-independent location/severity grading, blind severity visibility, missing-run accounting, frozen provider inputs and replay identity checks. The dataset remains development/provisional, with no new human sign-off.

- Updated evaluation checks: **43/43 passed**, including the regressions introduced during review; strict adapter typecheck passed.
- Combined checkout with PR #8's reviewed coverage changes: **313/313 Jest tests**, production typecheck and **43/43 evaluation checks** passed.
- A fresh ignored run directory produced **40 scripted records** (20 B1 + 20 B2-oracle). Both conditions reported recall 0, clean success 1, precision null, and no missing planned rows, as expected for the empty-output control.
- Scoring the same saved raw records and labels twice with the updated scorer produced **byte-identical summary JSON**. No original control files were overwritten.
- Reproduce with the README's plan/run/labels/score commands and fresh paths; build the bridge first. Current PR CI is the authoritative build/test status for the final pushed commits.

These checks establish executable tool behavior only, not model effectiveness, actual B retrieval, or human review efficiency.
