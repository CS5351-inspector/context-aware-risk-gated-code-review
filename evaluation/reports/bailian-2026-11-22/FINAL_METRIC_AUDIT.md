# Final independent metric audit

**PASS: the reviewed development summary agrees with an independent recomputation.** This is a human-reviewed exploratory component experiment, not formal heldout evidence and not 100% overall accuracy.

## Audit coverage and method

Read the frozen metric protocol and annotation rules. Independently aggregated all 40 development run records, all 40 archived provider/raw files, all 40 reviewed atomic judgments, and all 20 frozen gold files. Computation used a separate one-pass Python calculation, not `score.cjs` or the generated summary as the source of counts. The generated summary was used only for comparison. No API calls, credential reads, raw/label/code edits, commits or pushes were performed. This audit does not repeat behavioral proofs or re-adjudicate the user's accepted semantic judgments.

Verified all 40 raw-file SHA-256 values against their run receipts, exact equality of raw validated findings and run findings, provider usage against input/output token totals, one actual response per run, and per-run price arithmetic. Every validated finding is covered by an annotation. All confirmed packet annotations are unchanged from the historical AI suggestions and are present unchanged in the reviewed labels; the confirmation binds the suggestions' exact file hash. The label envelope binds the parsed run object's compact JSON SHA-256 (not the pretty-printed file-byte hash). No reviewer identity or date was added.

## Counts and denominators

| Quantity | B1 diff-only | B2 retrieved context |
| --- | ---: | ---: |
| Planned / started / actual calls | 20 / 20 / 20 | 20 / 20 / 20 |
| Complete / failed | 19 / 1 | 20 / 0 |
| Missing / not executed | 0 / 0 | 0 / 0 |
| Validated findings | 17 | 16 |
| Atomic annotations | 22 | 18 |
| Gold atoms before root deduplication | 9 | 9 |
| Duplicate known-root atoms | 1 | 1 |
| Deduplicated substantive claims | 21 | 17 |
| True positives / frozen gold roots | 8 / 8 | 8 / 8 |
| `false_positive` verdicts | 3 | 2 |
| `out_of_scope` verdicts | 9 | 6 |
| Scorer `fp` = the preceding two rows | 12 | 8 |
| Unresolved / novel | 1 / 0 | 1 / 0 |
| Frozen-gold micro and macro recall | 8/8 = 100% | 8/8 = 100% |
| Precision bounds | [8/21, 9/21] = [38.0952%, 42.8571%] | [8/17, 9/17] = [47.0588%, 52.9412%] |
| Macro precision bounds | [8/17, 9/17] = [47.0588%, 52.9412%] | [8/16, 9/16] = [50%, 56.25%] |
| Clean eligible / unresolved clean runs | 11 / 1 | 11 / 1 |
| Clean successes | 2/11 = 18.1818% | 4/11 = 36.3636% |
| Location agreement, true atoms | 9/9 = 100% | 9/9 = 100% |
| Severity agreement, true atoms | 2/9 = 22.2222% | 2/9 = 22.2222% |

The gold-positive cases are DEV-001, 003, 005, 007, 011, 013, 015 and 017. Each condition hits all eight. Cross-file recall is 4/4 and diff-sufficient recall is 4/4 in each condition. DEV-017 has two atomic assertions sharing one cache-membership gold root in each mode, so semantic TP is one per run, while location/severity still assess both assertions. Accepted location/severity booleans were independently checked against raw file/line/severity and gold acceptable locations/severity: all 18 true atoms locate correctly; four severity agreements across both modes come from DEV-001 and DEV-011.

Out-of-scope suggestions are substantive claims and remain in precision's denominator under the frozen protocol. They must not be silently removed, called additional TP, or conflated with the five explicitly false assertions. No point precision is reported because two judgments remain unresolved. Macro precision averages only runs/cases with a nonzero substantive-claim denominator: 17 B1 cases and 16 B2 cases; empty outputs have undefined precision.

## Unresolved judgments and failure retention

The two unresolved judgments are **DEV-018/B1/1 and DEV-018/B2/1**, concerning whether `Object.hasOwn` is available in the supported target runtime. Human confirmation accepts the proposed unresolved judgment; it does not supply the missing runtime contract. Both remain unresolved after confirmation, appear in the precision bounds, and remove one observation per condition from the 12 nominally clean cases, giving the correct clean denominator of 11. There are no novel defects or symmetric clean-reclassification exclusions.

B1 clean successes are DEV-002 and DEV-019. B2 clean successes are DEV-008, DEV-012, DEV-019 and DEV-020. Thus context adds successes on DEV-008/012/020 and loses DEV-002, a net gain of two; it is not uniformly better on every clean case.

**DEV-020/B1/1 remains a failed started run**: raw analysis status is `FAILED`, with required model-stage omission `INVALID_OUTPUT`. Its empty validated findings do not count as a clean success. It remains one of 20 started runs and one of 11 clean-eligible observations, and its known ¥0.001436 estimate remains in cost. It has no frozen gold, so retaining it does not create an extra recall denominator. No failure was dropped or replaced with a rerun.

## Context delta, latency and cost

| Measurement | B1 | B2 | B2 minus B1 |
| --- | ---: | ---: | ---: |
| Known input tokens | 5,606 | 8,564 | +2,958 (+52.7649%) |
| Known output tokens | 2,828 | 2,703 | −125 (−4.4201%) |
| Estimated CNY cost | ¥0.033836 | ¥0.038752 | +¥0.004916 (+14.5289%) |
| Worker latency p50 | 1,745 ms | 1,608 ms | −137 ms |
| Worker latency p95 | 3,023 ms | 2,401 ms | −622 ms |
| Clean-success rate | 18.1818% | 36.3636% | +18.1818 percentage points |
| Known-root recall | 100% | 100% | 0 percentage points |

Costs independently equal `(input_tokens × 2 + output_tokens × 8) / 1,000,000` CNY, using the frozen configured per-million rates. Total development cost is ¥0.072588 for 40 calls; usage and cost have zero unknown runs. These are configured-rate estimates, not invoices. The 12-call pilot is separate and is not pooled into the development quality metrics. Latency uses all started rows and the nearest-rank quantiles matching the summary; it is neither human time nor a claim about stable production tails.

All eight family-level paired recall deltas are zero, so every resample is zero and the reported 2,000-resample intervals [0,0] follow directly for all families, the four cross-file families, and the four diff-sufficient families. This degenerate interval does not show equivalence in real repositories. Observed precision bounds rise from 38.10–42.86% to 47.06–52.94%, with fewer non-TP substantive claims, but this small one-trial development sample supports a descriptive result, not a population-level superiority claim.

## Interpretation

The experiment detects all eight known synthetic roots in both modes, but also produces unsupported or out-of-scope suggestions, two unresolved compatibility judgments, and poor severity agreement against the accepted gold. **100% recall is not 100% overall accuracy.** Context shows no observed known-root recall gain on these cases, improves observed clean success and precision bounds, and increases estimated cost. No overall accuracy or mixed-scope F1 is inferred. Evidence remains `EXPLORATORY_OR_INCOMPLETE`, purpose `development`, scope `component`, boundary `C.reviewFiles.validated-findings`; it does not establish heldout, product gate, publication, UX or human-efficiency quality.

## Audited file fingerprints

These are exact file-byte SHA-256 values at audit time. Regenerating any affected evidence requires a fresh audit.

| Evidence relative to this report directory | SHA-256 |
| --- | --- |
| `development/runs.json` | `4df02fbf3325a8fb4495cb9affade9a9ee4577c33c8cedb52e324d19710a1cd0` |
| `development/labels-reviewed.json` | `d06707af161418f0d4fe71b360aa0a6d62673519550d0d93e076900a5ed2d7eb` |
| `development/summary-reviewed/summary.json` | `2a231289053c9c4d6cfbc13adb9cf29d001105e488385a480e5eb92dd75a8292` |
| `review/confirmed-packets.json` | `b1eadc7cef91c7a9a8206b4fee45b59777a2c173218dcc7d55d059ca14bde137` |
| `review/ai-suggestions.json` | `eda359fd85d15b0d3c315c592aaad1c5f7ba6ddfaae304075c108fbe7b1b004c` |
| `development/plan.json` | `32c72c2b78a3ce4c19ff153098b53a12b5b7a39e86cb07ca6e89e43d64afd0f3` |

All 20 gold files were included. Their aggregate manifest digest is `d897e46c2147ce90ca5f248a0efe58bd4fb5df24bab7e67373c5bcce25ba87ea`, computed as SHA-256 of the lexically filename-sorted UTF-8 lines `filename SHA256(file bytes)\n` for `evaluation/gold/DEV-*.json`. All 40 individual raw-file digests were verified against `development/runs.json`.
