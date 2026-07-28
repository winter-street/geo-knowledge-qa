# Synthetic Harness Validation

Split: `test`

This report validates the deterministic evaluation harness. It is not a model-performance claim. Automated judging is auxiliary only.

Human blind review: pending

| Metric | Value | Threshold | Status |
|---|---:|---:|---|
| recallAt5 | 1.000 | >= 0.80 | pass |
| mrrAt10 | 1.000 | >= 0.70 | pass |
| intentAccuracy | 1.000 | >= 0.90 | pass |
| toolSelectionAccuracy | 1.000 | >= 0.90 | pass |
| entityLinkTop1Accuracy | 1.000 | >= 0.85 | pass |
| citationPrecision | 1.000 | >= 0.90 | pass |
| refusalFalseAnswerRate | 0.000 | <= 0.10 | pass |
| multiTurnTaskSuccess | 1.000 | >= 0.80 | pass |
| unsupportedClaimRate | 0.000 | <= 0.35 | pass |
| unsupportedClaimImprovement | 0.500 | >= 0.20 | pass |

Latency: p50 104 ms, p95 275 ms.
