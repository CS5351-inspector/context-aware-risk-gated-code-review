# Sprint 2 decision record — binding a merge decision to the reviewed revision

Group 2 · inspector · Integration owner: Jianfeng Pang

## Decision

Run the course pilot on same-repository PRs targeting `sprint2-demo`. A read-only signal starts a trusted workflow on `main`. That workflow checks out its own revision, obtains the PR and file data through GitHub, and asks B, C and D to collect context, review the change and calculate risk. The Context run publishes an English report and commit status `inspector/risk-gate`. A manual Diff-only run writes comparison evidence to its Actions summary. [Signal](../.github/workflows/inspector-signal.yml) · [Live workflow](../.github/workflows/inspector-live.yml) · [Entry point](../src/inspector-action.ts)

| Decision | Reason and consequence |
| --- | --- |
| Bind the PR, base, merge base, head, mode and reviewer implementation revision to the run. Read source by SHA. Restore matching analysis only from a verified run of the trusted workflow on main. Incomplete analysis can also be reviewed by a human. | A new commit gets its own analysis. Approval events must reuse the same analysis. A missing artifact requires an explicit full Context run. The gate still consults current GitHub data. |
| Give one workflow writer at a time the PR's publication slot. Evaluate D's pure rules using current head, human identity, permissions and review history. Recheck before and after publishing success. | Withdrawal of approval can change the gate with no code change. The report and receipt identify the reviewed SHA. A failed report or status write is visible in the Actions run. |
| Share one application deadline across input, model and feedback. Count SDK attempts and reserve time for publication. | A slow model leaves time to report incomplete work. Budgets and known usage are recorded for comparison. Runner queue, checkout and installation lie outside the application clock. |

## Pilot configuration

The source of truth is `inspector-sprint2-v1`. Per PR the pilot allows 5 supported files, 7 model attempts including retries, up to 1 retry per file and 30 s per request. Application time is 240 s including a 30 s feedback reserve. The estimated per-request token window is 8,000 including 800 reserved for output. Context uses a 4-line margin, up to 2 definition lookups per file and up to 60 lines per definition. Both modes request `gpt-5.4-mini` with `reasoning_effort: none` through the configured OpenAI-compatible endpoint. The receipt captures the implementation revision, effective settings, coverage and provider usage when available. [Budget](../src/review/sprint2.ts) · [Frozen model configuration](SPRINT2_MODEL_CONFIG.json)

## Remaining limits

GitHub has separate operations for reading approvals, posting comments and writing statuses. A review can change between operations or before its event reaches the runner. A successful check cannot prove atomic merge authorization. The pilot assumes a distinct head SHA per demo PR because commit statuses are keyed by commit and context, while approvals belong to a PR. Administrators and ruleset bypass actors can have different merge rights. Provider availability and feedback delivery can fail independently. The [acceptance matrix](SPRINT2_GATE_ACCEPTANCE.md) records which transitions an ordinary Write member actually observed.
