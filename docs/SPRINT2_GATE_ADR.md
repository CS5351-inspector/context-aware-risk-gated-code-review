# Sprint 2 decision record — bind the gate to the reviewed revision

Group 2 · inspector · Integration owner: Jianfeng Pang

Status: reliability hardening based on main `0c1a0b6`; automated verification and real GitHub observations are recorded separately in the acceptance matrix.

## Decision and reasons

Run the pilot on same-repository PRs targeting `sprint2-demo`. A read-only [signal](../.github/workflows/inspector-signal.yml) starts a trusted [workflow](../.github/workflows/inspector-live.yml) that executes its own revision, reads PR code as data and invokes B/C/D. Context publishes `inspector/risk-gate`; Diff-only records comparison evidence.

1. **Immutable input.** Bind repository, PR, base, merge base, head, mode and implementation revision. Read source by SHA. The production adapter obtains patches from `compare/<merge-base>...<head>`, checks comparison identity, file count and uniqueness, and rejects missing lists or 300-or-more files. Unlike mutable PR-file reads with before/after checks alone, this binds the patch itself to captured commits. Rejecting the ambiguous [Compare API cap](https://docs.github.com/en/rest/commits/commits#compare-two-commits) is acceptable for this small pilot.
2. **Pure D, live A.** D calculates risk and approval decisions without network calls, allowing deterministic history/boundary tests. A obtains current permissions, non-author human identity and review history. Cache reuse requires the same analysis identity and a verified trusted-workflow artifact; missing analysis requires an explicit full run. A new head cannot inherit old approval.
3. **Coordinated publication.** A serializes participating writers per PR/mode (`queue: max`, `cancel-in-progress: false`) and reads current state rather than trusting event order. Cancellation alone cannot undo writes in flight. Clear old success before posting the report; check head and refresh approvals before/after success. Keep historical `gateAtReport` separate from `publication.finalGate`, including later WAITING. Report/status failures, and failed success retractions, remain visible in the run and receipt.
4. **Bounded execution.** Share an application deadline across input, model and feedback, reserving publication time. Record attempts, coverage, omissions and known provider usage. Invalid configuration and incomplete analysis cannot become automatic safe results; permitted human takeover remains explicitly marked.

## Pilot configuration

[`inspector-sprint2-v1`](../src/review/sprint2.ts): 5 files, 7 model attempts, 1 retry/file, 30 s/request, 240 s total including 30 s feedback reserve; estimated 8,000-token window with 800 reserved output tokens. Provider settings and tokenizer profiles: [RelayCore](SPRINT2_MODEL_RELAYCORE_CONFIG.json), [DeepSeek](SPRINT2_MODEL_DEEPSEEK_CONFIG.json), [GPT](SPRINT2_MODEL_CONFIG.json). Queue/setup time lies outside the application clock.

## Remaining limits and acceptance

GitHub reads, statuses, comments and merges are separate operations; reviews can change after the last recheck. This is not atomic merge authorization. Actions serialization covers participating jobs only; other writers need the same discipline. Demo PRs need distinct head SHAs because commit statuses are shared by SHA/context while approval belongs to a PR. On November 23, the branch protection API confirmed the required status, strict mode and administrator enforcement, with the native required-review setting empty. Inspector still requires one eligible current-head approval when automatic LOW/MEDIUM passing is unavailable. The regular live workflow is active. #16 demonstrates manual zero-model reconciliation, and the automatic review-event path remains to be verified in GitHub. [Gate](../src/review/gate.ts) · [Live workflow](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/actions/workflows/inspector-live.yml). Provider and feedback availability are independent failure modes. The [acceptance matrix](SPRINT2_GATE_ACCEPTANCE.md) separates automated interleavings, real API/status evidence and ordinary Write merge-box observations; it does not claim every concurrency schedule was proved safe.
