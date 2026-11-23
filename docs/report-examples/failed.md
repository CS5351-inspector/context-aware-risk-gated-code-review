## Inspector code review
**UNKNOWN risk · WAITING · FAILED**
Reviewed SHA: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` · Mode: context · Provider: live
Run: `45000000000-1` · Rule: inspector-sprint2-v1
Decision: APPROVAL\_REQUIRED.
Next action: Resolve the decision reasons and have an eligible non-author Write+ reviewer approve this commit.
Risk factors: ANALYSIS\_UNAVAILABLE.
Coverage: 0/1 supported files analyzed; 0 excluded.

### What was checked
- No files completed model analysis.

### What was skipped and why
- Not analyzed: src/duration.js — no successful model analysis was recorded.
- Required omission: src/duration.js — model / INVALID_OUTPUT.

### Why the run stopped
Required work was not completed: INVALID_OUTPUT. Missing analysis must not be interpreted as safe.

### Findings
No findings were returned, but analysis is FAILED; this is not a clean result.
Validation confirms coordinates and references only; it does not prove that a finding is correct.

### Evidence
- No retrieved context snippets were recorded; diff evidence is identified by file and line above.

### Analysis resources
Model: example-model · Duration: 2100 ms · Calls including retries: 2.
Input/output tokens: 640/unknown · Tokenizer: example-tokenizer.
Effective parameters: \{"temperature":0,"max\_tokens":800\}
These values describe this analysis only; runner queue and dependency-installation time are recorded separately.
