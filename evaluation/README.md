# F evaluation dataset v0.1

This is an executable **development dataset**, not a measured model benchmark or an independent holdout. All examples are synthetic JavaScript and all labels remain **provisional, awaiting independent human review**. No model API is used by the commands below.

## Run now

Requires Node.js 18.17+ (validated here with Node 24.18.0). No npm install or API key is needed for this standalone dataset.

```sh
node evaluation/validate.cjs
node --test evaluation/tests/dataset.test.cjs
node evaluation/export-input.cjs DEV-001 B1
node evaluation/export-input.cjs DEV-001 B2-oracle
```

Run from the repository root. `validate.cjs` runs only these trusted local synthetic fixtures, using a fresh temporary CommonJS directory for each snapshot. It is not a sandbox for arbitrary third-party code.

## Contents

| Family | Cases | Purpose |
| --- | --- | --- |
| grant-enum | DEV-001 faulty / DEV-002 fixed | Cross-file: the policy service's numeric GRANTED/DENIED values are not booleans |
| scheduler-units | DEV-003 faulty / DEV-004 fixed | Cross-file: the scheduler accepts seconds while the caller receives milliseconds |
| zero-limit | DEV-005 faulty / DEV-006 fixed | Diff-sufficient: zero is valid and must not select a default |
| index-boundary | DEV-007 faulty / DEV-008 fixed | Diff-sufficient: index equal to array length must not dereference undefined |
| active-users | DEV-009 clean | Equivalent filter/map refactoring, preserving id zero and input order |
| invoice-reduce | DEV-010 clean | Equivalent accumulation with an explicit zero initializer |

There are **6 families, 10 head snapshots, 4 defect roots and 6 clean/fixed snapshots**. All variants of a family stay in development. The cross-file designation means the stated defect depends on an unchanged API contract outside the diff; it is a provisional annotation, not proof that a model cannot infer the defect from the diff alone.

`families/*/family.json` records requirements, provenance, SHA-256 source hashes, executable counterexamples, exact expected faulty observations and context rationale. Every case has a nonempty base-to-head diff. The fixed case uses the same correct base as its faulty sibling and a different, contract-preserving implementation: it is a clean control, not a future patch shown to the model.

`cases/` contains input references and unified diffs; `gold/` contains atomic issue evidence. The validator checks all source hashes, applies diff hunks, checks identifiers/split/locations, runs correct bases and all heads, and rejects counterexamples that also fail on the base. Expected failures are checked for their actual value or specific exception, so a missing dependency does not masquerade as defect evidence.

The validator reports 50 behavior-check executions across bases and heads. Eight contract violations are **intentionally expected observations in the four faulty snapshots**. They are not eight independent bugs and not failing validation tests. Clean assertions cover the documented input domain and selected checks; they do not prove absence of every possible defect.

## Input isolation and next integration

The exporter emits only an opaque case ID, condition, public behavioral requirement, diff and optional source context. Gold, family variant labels, proof tests, expected outputs and explanations are excluded. Mount only exported inputs in a model/tool environment; do not expose the full `evaluation/` directory to a reviewing agent.

`B1` has no extra source context. `B2-oracle` provides all example head source files for diagnostic use. **Actual B2 retrieval is not implemented** and the exporter rejects that condition. Do not label full oracle context as production retrieval or report its performance as the product's Context result.

This dataset does not change production contracts, risk rules or gate policy. The peer's 55 reliability fixtures remain a separate asset; they are not copied here or counted as independent quality defects. Their two known sanity-check gaps still need integration work. The zero/default scenario was inspired by the peer discussion; all source code in this dataset is independently authored. Reference: [peer fixtures at e3bd1a5](https://github.com/ayame2847/context-aware-risk-gated-code-review-i-have-no-idea/blob/e3bd1a58633b7a4e44256843d52cf3567b11e76e/docs/SPRINT1_CONTRACTS_AND_FIXTURES.md). Code follows this repository's ISC license.

Before effect experiments: obtain a second human reviewer for each requirement/gold/context label; review severity; add licensed real-PR examples; build new family-separated heldout data; integrate actual retrieval/model adapters; freeze scoring, budget and paired trial manifest. No precision, recall, human-efficiency improvement or real GitHub gate success has been measured in v0.1.

## Review checklist

- [ ] Confirm the requirement and trigger for each of the four gold defects.
- [ ] Confirm acceptable locations, severity and required cross-file context.
- [ ] Review both clean-only changes and the four fixed controls for novel defects.
- [ ] Record reviewer identity, date, disagreements and evidence before upgrading provisional labels.

The JSON schema is a portable case-format description; `validate.cjs` is the executable validator and adds cross-file, hash, diff and behavioral constraints beyond the schema. Saved validation evidence lives in `reports/`; regenerate it after any data change.
