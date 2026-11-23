# Evaluation result
Evidence: **EXPLORATORY_OR_INCOMPLETE**
Scope: component; boundary: C.reviewFiles.validated-findings
Paired plan complete: true

| Condition | Started | Recall (micro) | Precision | Precision bounds | Clean success | Known cost CNY | Unknown cost runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | 20 | 1 | N/A | 0.381 to 0.4286 | 0.1818 | 0.0338 | 0 |
| B2 | 20 | 1 | N/A | 0.4706 to 0.5294 | 0.3636 | 0.0388 | 0 |

Full per-trial counts, status, latency, cost and family intervals are in summary.json.

- Synthetic cases only; no real-PR generalization
- Family labels may remain provisional; see run records
- No product gate/UX/human-efficiency conclusions
- No mixed-scope F1; novel precision and frozen recall are intentionally separate
