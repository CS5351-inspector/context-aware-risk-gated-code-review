# Human annotation and adjudication

## Case/gold approval (before formal evaluation)

```sh
node evaluation/cli.cjs review-template --case DEV-001 --out evaluation/runs/DEV-001-review-draft.json
```

Two independent humans read the requirement and both sides of the change, run the proof, inspect unchanged dependencies and fixed/clean controls, and decide whether the root cause, severity, acceptable location and context requirement are justified. Neither should simply accept the generating AI's explanation. Record concrete evidence and disagreements; resolve disputes before approving.

The generated digest binds the reviewed-format case, requirement, all source hashes, executable checks and issue list. For each case in a family, create `reviews/<case_id>.json` with that digest and two records containing distinct `reviewer`, `is_human:true`, `decision:"accepted"`, ISO `reviewed_at` and nonempty `evidence`. Then upgrade **all** cases/golds and the family to `label_status:"reviewed"` with the same `human_reviewers` list. Do not label an automated agent as a human. Runtime validation checks records and digests, not real-world identity: the team must verify authorship of sign-offs.

A rejected/uncertain case remains provisional and outside formal gold. Editing the data after approval requires fresh records. Do not change a development family's split to heldout after using it to tune prompts; add genuinely separate families and review for near-duplicate/source leakage. The format supports reviewed heldout cases but this release contains none.

## Output adjudication (after a run)

Use `blind` to export `review/packets.json`; a coordinator keeps `private/mapping.json` and original runs away from graders. Packets contain source, requirement, gold and actual findings, but no condition name, provider or run key. At least one human output adjudicator records their name/date; another adjudicator should resolve disputed or novel findings. This is separate from the two humans approving the dataset.

For each finding:

1. Keep one annotation for a single claim. For multiple independent defects, create multiple rows with the same finding ID but unique `atom_id` and evidence describing the exact claim. Do not manufacture extra claims from vague advice.
2. Set `root_id` identically only for claims sharing the same root cause **within this run**; no cross-run deduplication.
3. Select `gold` only for the supported known root and set its exact `gold_issue_id`. A paraphrase can match; correct location alone cannot.
4. Choose `novel` for a separately evidenced real defect; `false_positive` for an incorrect assertion; `out_of_scope` for an actionable claim outside this evaluation's bug scope. All non-gold verdicts use `gold_issue_id:null`.
5. Use `unresolved` if evidence is insufficient. Include pending reasoning but never guess to improve precision.
6. Record `location_acceptable` / `severity_acceptable` as true/false or null when not assessed. Grade semantic correctness independently.

The scorer rejects unknown gold IDs, unknown findings, duplicate atoms, conflicting root verdicts, stale labels, and final verdicts without reviewer/date/evidence. It cannot prove the human's reasoning: keep review evidence for team inspection. Missing annotations become unresolved.

A novel defect on a supposedly clean case requires relabeling, a new dataset version and consistent rescoring of both conditions/trials. Until resolved, the summary flags reclassification and does not count the case as clean success. Preserve the original frozen labels and original report; never silently improve only one condition.
