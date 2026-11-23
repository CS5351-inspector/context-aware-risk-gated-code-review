# Reproduce the Inspector Sprint 2 pilot

Inspector reviews added or modified JavaScript and TypeScript files in GitHub pull requests. Context mode reads nearby code and selected direct definitions at the reviewed commit. Its report explains the risk, coverage and next action, and the gate writes a status to that commit. Diff-only mode provides an experiment result without changing the gate.

See [normal, partial, failed, and publication-failure report examples](SPRINT2_REPORT_EXAMPLES.md). Reports distinguish checked files from skipped files, explain required and optional omissions, retain evidence refs, and preserve unknown usage as `unknown`. Long comments keep the decision, reviewed SHA, and next action before optional detail; the Actions receipt retains the structured data. If GitHub rejects report publication, a concise fallback is written to the step summary when available and always retained in the receipt.

## Run the local checks

In a fresh checkout, use Node.js 24 and run the same checks as [Test and Build](../.github/workflows/test-build.yml).

```sh
npm ci
npm run typecheck
npm test -- --runInBand
npm run test:evaluation
npm run verify:report
npm run build
node --check action/index.cjs
git diff --exit-code -- action
npm run smoke:model-budget -- --relaycore
```

The report verification executes the production risk, gate, renderer, and guarded publisher against four synthetic examples. It writes four standalone files in an isolated directory, compares them byte-for-byte with the committed reports, checks evidence and coverage content, and confirms the actual comment-rejection receipt. Its machine-readable result is written to `.cache/report-verification.json`; it makes no model calls or GitHub requests.

The smoke command uses simulated responses for nine scenarios, including model failure and budget limits. The commands above require no model key and make no inference requests. `npm ci` downloads dependencies. The build regenerates the tracked Action bundle. Run the build check from a clean checkout to confirm the bundle matches the committed files. The evaluation tests cover the input and scoring tools. The [evaluation README](../evaluation/README.md) explains how to prepare and adjudicate a paired study.

## Inspect the recorded GitHub pilot

[PR #12](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/pull/12) is the closed clean example and its source branch retains the fixture. The [paired Actions run](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/actions/runs/44686165232) pinned head `927a00a756fbe5690ab4334dac63258280efc25f` and ran each mode once against the same RelayCore model. Open the [Context report](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/pull/12#issuecomment-7032036243) to see the related definition in `demo/sprint2/duration.js` and the LOW decision. The [receipts](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/actions/runs/44686165232/artifacts/14605744820) carry the base, head, model, coverage, omissions, provider usage and publication result. The [recorded summary](SPRINT2_GATE_ACCEPTANCE.md#paired-pilot-observations) preserves the principal measurements for use after artifact expiry.

## Set up a live acceptance run

Check the [live workflow's current state](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/actions/workflows/inspector-live.yml) before preparing a live run. Eligible PR changes can send their diff and selected context to the configured provider. Use an open, same-repository PR targeting `sprint2-demo` for the next approved live session. Keep its head distinct from other open pilot PRs. The enhanced workflow and GitHub signal are defined in [Inspector live review](../.github/workflows/inspector-live.yml) and [Inspector review signal](../.github/workflows/inspector-signal.yml).

| GitHub setting | Value or check |
| --- | --- |
| Repository Actions variable `INSPECTOR_MODEL_BASE_URL` | URL of the approved provider. The team's frozen RelayCore profile uses `https://api.relaycore.cn/v1`. |
| Repository Actions secret `INSPECTOR_MODEL_API_KEY` | The repository owner configures the credential for that provider in Actions Secrets. |
| Required status for `sprint2-demo` | `inspector/risk-gate` from GitHub Actions. Confirm strict checks, administrator enforcement and any bypass rules before recording mergeability. |
| Reviewer | A human with ordinary Write access, using an account separate from the PR author. |

When the live workflow is active, open the same-repository demo PR or dispatch **Inspector live review** on `main` with its number and mode `context`. The original demo branch already contains `demo/sprint2/duration.js` on the base. For a fresh LOW fixture, branch from `origin/sprint2-demo` and add a one-file caller such as this version of the example.

```js
import { minutesToSeconds } from './duration.js';

export const workshopDurationSeconds = minutesToSeconds(60);
```

Place it at `demo/sprint2/workshop.js`. Check the report's head against the PR and inspect the receipt's `publication.commitStatus`. A `PUBLISHED` receipt can report `pending` when the gate is waiting for a review. To compare modes, hold the base, head and configuration fixed and run `diff-only` separately. Use the paired receipt measurements and log runner queue, setup and application time separately.

For the approval sequence, use the [ordinary Write walkthrough](SPRINT2_GATE_ACCEPTANCE.md#ordinary-write-walkthrough). Verify the regular Context job uploaded an analysis artifact before asking for approval. Approval-only reconciliation uses an artifact from the trusted workflow matching its revision, PR, base, head, mode and provider. The earlier one-off paired pilot is historical evidence. Record `reusedAnalysis: true` and `newModelCalls: 0` on the review-event receipt to demonstrate reuse. If `main` changes during the sequence, verify the workflow revision and create a fresh analysis for the same head during the agreed session before continuing.

A teammate can confirm independent reproduction by adding an acceptance note with the commit, commands run, and any missing prerequisite or failed step. Mark live scenarios observed only when the linked evidence includes the actual GitHub result.
