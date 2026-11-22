# Human annotation and adjudication

## Case/gold approval (before formal evaluation)

```sh
node evaluation/cli.cjs review-template --case DEV-001 --out evaluation/runs/DEV-001-review-draft.json
```

The workflow is **先 AI 生成结果，然后由我人工复核**. One human reads the requirement and both sides of the change, checks the proof, unchanged dependencies and fixed/clean controls, and decides whether the root cause, severity, acceptable location and context requirement are justified. AI explanations are supporting material. Record the decision and concrete evidence; unresolved issues remain explicit. The current 20 cases have been confirmed without changes.

The generated digest binds the reviewed-format case, requirement, all source hashes, executable checks and issue list. For each case in a family, create `reviews/<case_id>.json` with that digest and one accepted record containing `is_human:true`, `decision:"accepted"` and nonempty `evidence`. Do not record reviewer identity or review date. Then upgrade **all** cases/golds and the family to `label_status:"reviewed"`; the compatibility `human_reviewers` arrays may remain empty. Do not label an automated agent as a human. Runtime validation checks acceptance and content binding; the confirmation must actually have come from the user.

A rejected/uncertain case remains provisional and outside formal gold. Editing the data after approval requires fresh records. Do not change a development family's split to heldout after using it to tune prompts; add genuinely separate families and review for near-duplicate/source leakage. The format supports reviewed heldout cases but this release contains none.

## Output adjudication (after a run)

Use `blind` to export `review/packets.json`; a coordinator keeps `private/mapping.json` and original runs away from graders. Packets contain source, requirement, gold and actual findings including predicted severity, but no condition name, provider or run key. The user reviews the model-output judgments and sets the envelope to `review_status:"reviewed"`; no name or review date is needed. Keep disputed or novel findings unresolved until evidence supports a decision. Dataset acceptance does not automatically approve future model-output judgments.

For each finding:

1. Keep one annotation for a single claim. For multiple independent defects, create multiple rows with the same finding ID but unique `atom_id` and evidence describing the exact claim. Do not manufacture extra claims from vague advice.
2. Set `root_id` identically only for claims sharing the same root cause **within this run**; no cross-run deduplication.
3. Select `gold` only for the supported known root and set its exact `gold_issue_id`. A paraphrase can match; correct location alone cannot.
4. Choose `novel` for a separately evidenced real defect; `false_positive` for an incorrect assertion; `out_of_scope` for an actionable claim outside this evaluation's bug scope. All non-gold verdicts use `gold_issue_id:null`.
5. Use `unresolved` if evidence is insufficient. Include pending reasoning but never guess to improve precision.
6. Record `location_acceptable` / `severity_acceptable` as true/false or null when not assessed. Grade semantic correctness independently.

The scorer rejects unknown gold IDs, unknown findings, duplicate atoms, conflicting root verdicts, stale labels, and final verdicts without completed human review and per-claim evidence. It cannot prove the human's reasoning: keep review evidence for team inspection. Missing annotations become unresolved. Atom/root IDs must be nonblank strings. Location and severity judgments are scored per adjudicated true atom, including duplicate-root assertions that may point at different coordinates; the summary exposes assessed-atom counts. Semantic precision and recall still deduplicate root causes.

A novel defect on a supposedly clean case requires relabeling, a new dataset version and consistent rescoring of both conditions/trials. Until resolved, the summary lists the affected case IDs and excludes that case from clean success in every condition and trial, including runs that did not discover the novel issue. Preserve the original frozen labels and original report; never silently improve only one condition.
