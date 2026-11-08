# Evaluation protocol v0.2

## Questions and boundaries

RQ1: with the same model, prompt body, public requirement and valid output contract, does actual retrieved context improve known-defect recall, particularly for cross-file families? RQ2: what happens to precision, clean-change success, latency and cost?

B1 is diff-only; B2 calls B's real `CollectContext`; B2-oracle supplies all whitelisted head source and is diagnostic only. No B0 historical baseline is implemented in this toolkit: do not infer one from the scripted control. `evaluation_scope=component` and `output_boundary=C.reviewFiles.validated-findings` are the only implemented boundary. It does not execute risk, gate, GitHub publication or E reporting. Component pilot evidence cannot be presented as final product quality.

The public behavioral requirement is appended identically to both C prompts using version `inspector-c-v1+public-requirement-v1`. It is part of the evaluated treatment design, not a change to production C. Precise message token counting must include that suffix and provider message framing. Removing it requires a new protocol/config, not silently changing one condition.

## Data and review

Current 12 families/20 snapshots are **development/provisional**. New source families, license checks, independently reviewed labels and leakage review are required before `purpose=formal`. Validator support for heldout does not mean a heldout set currently exists. All variants of one family stay in one split. Identical head fingerprints cannot cross splits; near duplicates, prompt hints and training contamination still need human investigation. Public data is not a blind test of unseen model training data.

A gold defect needs a requirement, root cause, severity rationale, acceptable locations, necessary source context and a specific executable counterexample. The correct base/fixed snapshots must satisfy the declared domain. Current schema supports one declared root per buggy snapshot and one buggy/fixed pair per non-clean family; expand validator/schema explicitly before introducing multi-root or multi-file changes. Only `review.js` changes in this version. This is a deliberately bounded benchmark format, not an arbitrary PR importer.

Two independent humans sign off the complete case/gold content. Templates are not approval. Generated examples and AI method reviews do not count as human sign-off. A changed requirement, proof, code hash or issue invalidates the record digest. Novel defects during output review trigger a versioned label amendment and symmetric rescoring; do not quietly change one mode's answers.

## Freeze and execution

Freeze data fingerprint, exact source/dependency fingerprint, Git baseline, model and effective parameters, provider module hash, actual context version, tokenizer, prompt, split, case list, paired schedule, trials, thresholds, budget and stop rule. Planner validates and hashes the plan. Runner rejects changed data/implementation or stale compiled bridge. The bridge freezes independent copies before invoking provider hooks so a hook cannot rewrite the experiment it is checked against. Saved runs are checked against raw treatment/model/prompt metadata; worker-failure and not-executed rows must preserve their matching evidence and unknown usage. Per-case/trial B1 and comparison condition are scheduled together with randomized within-pair and pair order; each run gets a fresh process. Same trial ID means pairing, not shared random noise.

Pilot uses one trial; formal examples may start at three, but choose the number and sample count before viewing heldout results. No sample size here guarantees statistical power. All heldout thresholds, practical recall gain and tolerated precision/clean loss must be filled and approved before generating a formal plan. `formal_approval` is an execution record, not a replacement for actual team agreement.

The runner reserves an entire pair's worst-case worker time, calls (derived from max runs × C maxCalls), token and cost allowance before starting. It does not refund reservations, so it may stop conservatively. Pair budget refusal creates two `not_executed` rows. Once a run starts, timeout/invalid output/partial completion stays in the denominator; no best-of-k selection or later dropping failures. Worker timeout kills the worker process; adapters must not spawn unmanaged subprocesses. Interruptions leave checkpointed records; missing planned records make the summary incomplete. Resume is intentionally not implemented: retain the interrupted evidence and use a new run ID, with the protocol stating how repetitions are handled.

## Grading

Preserve provider-shaped raw responses and C's actual findings separately. Production coordinate/reference validation is not semantic truth. Humans split multi-issue comments into atomic claims, match by root cause and effect (not string equality), deduplicate true repetitions and judge unmatched claims. Verdicts: `gold`, `novel`, `false_positive`, `out_of_scope`, `unresolved`. Every accepted judgment has reviewer, date and evidence; unresolved never defaults to false positive. Blind export hides condition/provider identifiers, but linguistic cues may still reveal treatment; record this limitation.

A gold root counts at most once per run. Repeated mentions get a common root ID; known-gold duplicates collapse even if separate IDs were assigned. Novel roots require evidence. Out-of-scope substantive suggestions remain in actionable precision's denominator. Location/severity are separate optional human judgments, so valid semantics are not discarded only for a slightly wrong line.

## Metrics

- Frozen-gold recall = hits / known gold, including started failures as misses. `not_executed` is separately reported. No union across trials.
- Precision = true adjudicated claims / deduplicated substantive claims. Unresolved claims produce bounds `[known TP / total, (known TP + unknown) / total]`, not a single precision. Zero denominator is null/N/A.
- Novel TP contributes to precision but not frozen recall. No mixed-denominator F1 is produced.
- Clean success requires complete analysis and zero claims. Unknown judgments make that clean observation unresolved; a confirmed novel defect flags reclassification and excludes it until a new gold version is consistently rescored. Counts and affected case IDs accompany exclusions; a novel defect invalidates the clean label symmetrically across all conditions and trials.
- Micro metrics pool counts; macro metrics average trials within a case, then cases with defined denominators. Missing/undefined values are disclosed, not filled with 0. Each condition reports planned, started, explicitly not-executed and missing-record counts separately.
- Location accuracy and severity agreement are per adjudicated true atom, including repeated-root assertions; assessed-atom counts are reported. This makes these optional judgments independent of annotation order, while semantic recall/precision remain root-deduplicated.
- Recall delta uses paired family resampling within category strata, first averaging trials; 2,000 deterministic bootstrap samples. Fewer than two faulty families or incomplete paired schedules produce no interval. This is a small-sample exploratory interval, not a generalization certificate. Current data has only four cross-file faulty families.
- Latency includes worker setup, retrieval, C processing/retries and termination, with p50/p95 and timeouts. C's own duration is saved in raw for decomposition. Small tail estimates are unstable.
- Token usage missing from the provider remains null. Pricing is explicitly supplied, dated and model-bound. `cost_usd` is an estimate from known input/output usage at the supplied rates, not a billing invoice; absent usage remains null. Cached/batch/discounted billing is not modeled: use conservative uncached rates for budget reservation and disclose this in a live report. Known subtotal and unknown-run count are separate; no claim of free live calls from missing usage.

`PLUMBING_CONTROL_NOT_MODEL_EVIDENCE`, `EXPLORATORY_OR_INCOMPLETE` and `FORMAL_COMPONENT_RESULTS` describe evidence scope. Formal status requires a reviewed heldout plan, live provider, complete pairs and adjudicated results; it does not assert that the model improved or that confidence targets were met. Inspect the interval against preregistered effect and guardrail targets before making any benefit claim. The summary records the scoring source hash, so rescoring saved evidence with a corrected scorer is distinguishable from the original summary.

## Optional extensions, outside the core implementation

RQ4 human time requires real participants, balanced manual/assisted tasks, correctness and active time measured together; API latency is not human time. RQ5 strategy value requires D's frozen policy and independent human labels of necessary review; D's own risk score cannot be its ground truth. These experiments are specified in the personal plan but are not implemented or claimed complete by this PR.

## Method references and adaptation

This implements the applicable principles researched for the F execution plan; it does not claim that sources mandate our counts, directory layout or numerical thresholds.

- Anthropic: [Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents), [define success/build evaluations](https://platform.claude.com/docs/en/test-and-evaluate/develop-tests), [building evals](https://platform.claude.com/cookbook/misc-building-evals), [writing tools](https://www.anthropic.com/research/writing-tools-for-agents), [tool evaluations](https://platform.claude.com/cookbook/tool-evaluation-tool-evaluation): task/trial separation, meaningful outcomes, deterministic checks where possible, human calibration, isolation and heldout discipline.
- [Qodo PR-Review-Bench](https://huggingface.co/datasets/Qodo/PR-Review-Bench), [Martian code-review benchmark](https://github.com/withmartian/code-review-benchmark), [ReviewBench methodology](https://github.com/review-bench/ReviewBench/blob/main/docs/METHODOLOGY.md): atomic defect evidence, matching/deduplication and explicit precision denominators. No external benchmark data imported here.
- [Google AutoCommenter](https://arxiv.org/html/2405.13565v1), [Atlassian RovoDev](https://arxiv.org/html/2601.01129v2), [MetaMateCR](https://arxiv.org/html/2507.13499v1), [ContextCRBench](https://arxiv.org/html/2511.07017v2): distinguish comment alignment, correctness, real adoption and human outcomes; freeze source-time context. These have different tasks/deployment settings, not directly interchangeable performance baselines.

Sources were researched for the preceding plan; this implementation pass did not reread every paper or run external benchmarks. No uncalibrated LLM judge or code-string exact matching is used for semantic truth.
