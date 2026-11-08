# F evaluation handoff — 2026-11-08

## Repository baseline and ownership

Read-only GitHub checks this session showed PR #2–#6 merged. PR #4's original branch `feat/evaluation-mvp` was fast-forwarded to main `c9b4e40` before this work. This release continues that branch with a new follow-up PR; a merged PR #4 cannot be updated as a new review. No main push or automatic merge is part of this handoff.

A's merged `src/review/contracts.ts` and `docs/SPRINT1_HANDOFF.md` supersede the earlier unmerged-contract assumptions in the personal planning document. B/C people remain as specified by the team's latest assignment; D/E remain pending. All members keep their own module tests; F maintains evaluation assets and experiments only.

## What is actually ready

- Revised data format no longer hardcodes 10 cases or 6 families; now 12/20 with per-case split/label state and review-record support. Original cases and A's integrity improvements preserved.
- All cases have executable behavioral evidence. New families add tenant cache-key, inclusive endpoint, numeric sort, falsy cache, copy/reverse and own-key filter scenarios. None is claimed as a sourced real-world PR.
- Experiment plan, strict C component bridge, whole-pair budgeted process runner, checkpoints/raw results, blind export, atomic human judgments and statistics are executable.
- Deterministic known-output checks exercise scoring/duplicate/novel/unknown/denominator behavior; integration controls call the existing C module, not `expected` as output.
- A complete scripted control run is saved under `reports/control-v0.2/`. It is specifically **not** live model evidence. It deliberately produces no findings on either condition.

## What still needs people or other modules

| Dependency | Owner / next action | F can do meanwhile |
| --- | --- | --- |
| Case/gold human review | Two independent humans; F prepares proof and review template | Data/scoring tooling, provisional exploratory work |
| Real client and accurate message-aware tokenizer | A/C supply a versioned trusted provider module | Scripted C integration controls; never fake a live tokenizer |
| Actual retrieved context | B supplies `collectContext` under common contracts | Oracle diagnostic only, clearly named; no claim about B2 |
| Independent evaluation families | F curates licensed source-separated data and obtains human gold review | Develop on current synthetic controls; do not relabel tuned families heldout |
| Final product output boundary | A/E provide actual reporting path; D if required by the integrated pipeline | C component pilot with explicit scope |
| Risk strategy / human efficiency | D policy + independent labels / real participants | Protocol and record templates; no results invented |

## Next execution sequence

1. Run `npm run test:evaluation`; inspect the 12 family proofs and review logs. Choose real source families only after checking license, snapshot date and independence.
2. Organize actual human review; use `review-template`. Preserve unresolved issues and provisional labels. Upgrade a complete family with fresh bound records, not just its `label_status` field.
3. With A/B/C, build the ignored live-provider module described in `ADAPTERS.md`, freeze exact settings and budget, select a small development pilot and run with explicit `--live`.
4. Blind human adjudication; inspect failures, missing usage, scope and retrieved source. Recompute summaries from raw/labels. Revise tools on development data, not heldout.
5. Freeze new reviewed independent data and protocol before formal comparison. Keep exact run evidence and report negative results as well as positive ones.
6. Submit later changes on the agreed `feat/` workflow, review before merge. Do not silently change A's CI, production guard, B retrieval or C retry/parser in an evaluation PR.

The toolkit blocks formal plans without appropriate reviewed data and configuration. Passing tooling checks does not mean F's full empirical study is complete; report which stage has actually finished.
