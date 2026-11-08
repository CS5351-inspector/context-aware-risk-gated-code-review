# Verification — evaluation toolkit v0.2

Date: 2026-11-08. Baseline: merged main `c9b4e40`; feature branch: `feat/evaluation-mvp`. The exact working implementation is additionally captured in the control plan and receipt hashes. This is an engineering verification report, not a live model evaluation report.

## Executed checks

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

The control returns valid empty model-shaped responses. Its expected buggy recall is 0, clean success 1 and precision N/A, with status `PLUMBING_CONTROL_NOT_MODEL_EVIDENCE`. Those values verify tool behavior only; they do not measure a model. Raw results, run records, plan, placeholder labels and summary are saved together.

`receipt.json` hashes the delivered evaluation files and package scripts (excluding itself and ignored build/local-run/provider paths). Historical v0.1 receipts remain in Git history; the current receipt does not pretend the old validation still covers changed data. Runtime identity is separately pinned by the plan's source/dependency fingerprint and bundled bridge receipt.

No real model invocation, independent human sign-off, real-PR benchmark, final product/gate evaluation, human-time measurement or RQ5 policy experiment was executed. See `../docs/HANDOFF.md` for owners and prerequisites. Remote PR CI status is independent of these local results.
