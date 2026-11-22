# F evaluation handoff — Sprint2

## Current baseline and ownership

The working baseline is main `0c1a0b6` plus the current evaluation changes on `feat/evaluation-mvp`. Earlier evaluation PRs #4 and #7 are merged; submit this follow-up as a new PR on the same branch. Do not push main or merge automatically.

A owns integration and reliability acceptance; B owns actual context retrieval; C owns the live model client, tokenization and resource control; D owns gate rules/lifecycle; E owns user-facing reports. F owns evaluation assets, experiments and evidence aggregation. Each owner retains their module tests.

## Completed locally

- The user reviewed all 20 synthetic snapshots without changes. Workflow: **先 AI 生成结果，然后由我人工复核**. One human confirmation is sufficient; no reviewer identity or review date is collected.
- The 12 families, 20 cases and gold records are `reviewed`, with a content-bound accepted record per case. The data remains `development`, not an independent heldout benchmark.
- The [Chinese review packet](../review-packet/README.md) preserves requirements, source, counterexamples, AI suggestions and accepted limitations. Context necessity is not assumed just because a family is cross-file.
- The [Sprint2 provider](SPRINT2_ADAPTER.md) connects the actual merged B collector, C client and matching tokenizer. Pilot and full development configurations can be generated without making a request.
- Offline checks exercise actual B/C integration with scripted responses, including an isolated worker and tokenizer assets. They are not real-model scores.
- Runner, blind grading, root-cause scoring and version-bound evidence remain available. Output-review envelopes use pending/reviewed status and per-claim evidence instead of requiring names/dates.

## Remaining work and dependencies

| Task | Dependency / next action |
| --- | --- |
| Freeze executable live configuration | Confirm account-specific model access, applicable pricing, total spending limit and the evaluated code version; do not invent rates or silently substitute a service |
| Paired pilot | Run the six preselected snapshots in B1 and actual B2; preserve all outcomes, raw responses, snippets, calls, usage and time |
| Development comparison | Freeze a separate plan for all confirmed cases after pilot integration checks; do not select favorable runs or mix implementations |
| Human output grading | Let the user review actual findings; only then mark output judgments reviewed. Dataset approval does not approve model output |
| Evidence and conclusion | Recompute metrics, summarize scope/failures/limitations and link A/D's real reliability evidence; unresolved acceptance items stay unresolved |
| Team delivery | Commit, push `feat/evaluation-mvp`, open a new PR and obtain team review |

The current component experiment stops at C's validated findings. It does not execute D/E publication or validate branch protection; A/D's real PR records cover those separate claims. Independent heldout data, source licensing and leakage review are prerequisites for a later formal benchmark, not results supplied by this development run.

## Execution and historical evidence

Follow [the current execution checklist](SPRINT2_EXECUTION.md), [adapter commands](SPRINT2_ADAPTER.md) and [annotation guide](ANNOTATION.md). After changing data, configuration or implementation, rebuild and generate a new plan. Record unknown usage as unknown; started failures remain in evaluation denominators.

`reports/control-v0.2/` is a historical scripted no-finding control frozen against provisional metadata. Its fingerprint differs from the reviewed dataset even though case source and expected behavior are unchanged. Reproduce it from its matching historical checkout. Never rewrite historical hashes or silently apply the current dataset to old receipts.

The evidence audit is [here](SPRINT2_EVIDENCE_AUDIT.md). Passing local checks or accepting the dataset does not establish model quality, resource improvements or full NFR acceptance.
