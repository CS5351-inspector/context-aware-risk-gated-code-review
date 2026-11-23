# Human review records

Workflow: **先 AI 生成结果，然后由我人工复核**.

All 20 current development snapshots have been confirmed by the user without changes. Each record stores one accepted human decision, concrete confirmation evidence and a content digest. Reviewer names and review dates are not collected. Case, gold and family metadata is `reviewed`; their split remains `development`, not heldout.

Use `node evaluation/cli.cjs review-template --case DEV-001 --out evaluation/runs/review-draft.json` for future reviews and follow [the annotation guide](../docs/ANNOTATION.md). Templates start pending. Never copy synthetic test approvals into this directory or mark AI-only output as human-reviewed.

Changing source, requirements, behavioral checks or gold invalidates the bound record and requires renewed confirmation. Upgrade a whole family consistently. Model-output grading is a separate activity after real runs; these dataset records do not approve model findings.
