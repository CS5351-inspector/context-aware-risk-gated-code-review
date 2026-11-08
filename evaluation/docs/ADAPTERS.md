# Connecting the evaluation runner to A/B/C

## Current implemented boundary

`evaluation/adapters/production.ts` imports C's actual `reviewFiles` and A's `deriveAnalysisStatus`. `src/review/contracts.ts` is the shared source of truth. It builds a synthetic `ReviewInput` from the pinned diff/head, and supplies a strict head-only `ReadFileAtRef`. SHA strings here identify content snapshots; they are not claimed to be real GitHub commits. There is one changed `review.js` per dataset case.

The evaluator appends the same public requirement in both modes; it neither reimplements Finding conversion nor adds a second production risk/gate/version/publication guard. It does verify experiment source identities and source-content correspondence. A final-product boundary is intentionally rejected until the team provides a real full-output adapter.

## Trusted provider module

Write a **local ignored** `evaluation/local-provider.cjs` that exports:

- `metadata`: `kind:"live"`, a nonempty `version`, `tokenizer_id`; for B2 also `context_kind:"actual-retrieval"` and `context_version` identifying the real B implementation.
- `createClient(config)`: C-compatible client with `effectiveParameters` and `completeReview(prompt, {signal, timeout, maxRetries, maxOutputTokens})`. Return the real provider completion including `finish_reason` and usage; honor cancellation. Use C's expected shape, not our gold or an expected output.
- `countInputTokens(prompt, config)`: exact model/message-aware counter, including the decorated requirement and message framing; no character/byte estimate labelled exact.
- `collectContext(input, readFile, budget)`: B's actual function. Only needed for B2. Return versioned snippets and omissions under the common contract. Do not call full source delivery actual retrieval.

This PR supplies no live provider or API key, and does not guess B's future export name. A/C own real client/tokenizer configuration; B owns retrieval. The default `scripted.cjs` contains an explicit zero-token counter **only because no model is invoked**; never reuse it in live execution. The bridge gives providers deeply frozen copies of the configuration and input, including changed-file patches and budgets. Treat these as read-only; create a private copy for local transformations. A client cannot change the expected model/settings by editing the configuration passed to it. Live adapters are trusted local code, not OS-isolated; avoid loading gold or the whole evaluation directory in them.

## Configure, freeze, execute

Copy `config/offline.json` locally and change:

- `provider_kind` to `live`, conditions to `["B1","B2"]` for the main comparison; keep pilot purpose `development` initially.
- Exact `model`, `effective_parameters` **as returned by C**, `tokenizer_id`, and `prompt_version:"inspector-c-v1+public-requirement-v1"`. C adds `maxRetries:0` and the actual output-limit field (`max_tokens` or `max_completion_tokens`); freeze those too.
- `adapter_sha256` to SHA-256 of your provider module; `context_version` to B's actual code version. The runner also freezes in-repo source/dependency hashes. External adapter dependencies must be pinned and documented by the adapter owner.
- `pricing:{model, currency:"USD", checked_at, input_per_million, output_per_million}` and explicit positive cost/time/token/call budgets. Rates are caller-provided dated estimates; no current pricing is assumed here.
- Optionally `case_ids` for a smaller pilot; unknown IDs or duplicates are rejected. Do not select cases after seeing results.

For formal runs additionally supply a new reviewed heldout split and `formal_approval:{approved_by, approved_at, stopping_rule, minimum_recall_gain, maximum_precision_loss, maximum_clean_success_loss}`. Values are project choices agreed before the run; filling JSON does not substitute for agreement or gold review.

```sh
node evaluation/build-adapter.cjs
node evaluation/cli.cjs plan --config /path/to/live-config.json --out evaluation/runs/pilot-plan.json
node evaluation/cli.cjs run --plan evaluation/runs/pilot-plan.json --adapter evaluation/local-provider.cjs --live --out evaluation/runs/pilot
```

`--live` is a deliberate local execution switch, not automatic permission to exceed agreed budget. Preserve errors and unknown usage. Retry policy is handled by C; the experiment runner does not add another retry layer. Both conditions must use the same model/settings and output boundary. A changed tokenizer/prompt/context/adapter requires a new plan. Do not reuse the demo control report as live evidence.

## When dependencies are missing

- A contract already merged: use `src/review/contracts.ts`; old PR #3/#5 candidate interfaces are historical.
- B unavailable: finish dataset/scoring and oracle diagnostics; no actual B2 result.
- C tokenizer/client unavailable: run scripted plumbing only; do not invent token counts.
- D/E unassigned: proceed with component evaluation. Final reporting/gate/human-use conclusions remain out of scope.
- Human reviewers unavailable: retain provisional labels and exploratory status.
