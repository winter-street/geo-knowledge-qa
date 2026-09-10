# Public Synthetic Evaluation

This directory contains deterministic, privacy-safe fixtures for validating the evaluation harness. It contains no real geological reports, document titles, excerpts, coordinates, credentials, model answers, or course materials.

## Files

- `suite.json`: 80 single-turn cases and 20 three-turn conversations. Every case is marked `synthetic` and assigned to either the `development` or `test` split.
- `synthetic-validation-run.json`: the complete 80/20 synthetic suite plus deterministic selected-split outputs used to exercise all metric calculations. It is not a captured model run.
- `report.test.json` and `report.test.md`: machine-readable and human-readable test-split reports.

Regenerate the files from the backend directory:

```sh
npm run evaluation:generate
```

The generated report proves only that schemas, split isolation, calculations and thresholds are wired correctly. `evaluateRun` validates the complete suite before it accepts a selected-split result set. Development and test fixtures use disjoint synthetic entity, document, structure and region pools.

Real Direct, RAG, KG, Hybrid and Agent measurements run through the private adapter in `src/services/evaluation/private-runner.ts`. That adapter dispatches the requested mode but returns only derived labels, claim counts, citation IDs and latency; generated answers and source text are never added to the public run format.

Automated judging is auxiliary. Final model-performance claims require a separate run against held-out cases followed by anonymous human blind review across both the selected single-turn and multi-turn samples; the public report intentionally leaves that review status as `pending`.
