# Evaluation result
Evidence: **EXPLORATORY_OR_INCOMPLETE**
Scope: component; boundary: C.reviewFiles.validated-findings
Paired plan complete: true

| Condition | Started | Recall (micro) | Precision | Precision bounds | Clean success | Known cost CNY | Unknown cost runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | 20 | 0 | N/A | 0 to 1 | 0.6667 | 0.0338 | 0 |
| B2 | 20 | 0 | N/A | 0 to 1 | 1 | 0.0388 | 0 |

Full per-trial counts, status, latency, cost and family intervals are in summary.json.

- Synthetic cases only; no real-PR generalization
- Family labels may remain provisional; see run records
- No product gate/UX/human-efficiency conclusions
- No mixed-scope F1; novel precision and frozen recall are intentionally separate
