# Performance Evaluation Harness

This directory contains the application-level performance harness for the geology investigation Agent. It measures the existing Node.js orchestration, retrieval, knowledge-graph access, SSE protocol, persistence, and failure handling. It is not a GPU, CUDA, training-framework, or inference-engine benchmark.

## What Is Public

- `load-questions.json` contains generic synthetic geology prompts for repeatable load tests.
- `suite.example.json` documents the private-suite schema with placeholders only.
- The evaluator source and deterministic model stub are tracked in `backend/src/services/performance/`.

Real questions, document titles, evidence text, coordinates, answers, credentials, and raw per-request observations stay local. Private suites and generated output are ignored by Git under `performance/private/` and `performance/output/`.

## Prerequisites

- Node.js 22.x (the checked environment currently uses 22.22.2; the project range is `>=22.18.0 <23`).
- For `performance:local`, the private Flask retrieval service on port 5000 and Neo4j on Bolt port 7687 must already be healthy.
- No external model or API key is needed for `smoke`; it starts an isolated OpenAI-compatible model stub.

## Commands

Run from the repository root. On Windows PowerShell use `npm.cmd` when execution policy blocks `npm.ps1`.

```powershell
npm.cmd --prefix backend run performance:smoke -- --label smoke-v1
npm.cmd --prefix backend run performance:local -- --profile smoke --label private-local-smoke
npm.cmd --prefix backend run performance:local -- --profile formal --label baseline-v1
npm.cmd --prefix backend run performance:report -- --run backend/evaluation/performance/output/<run-id>
```

The formal local profile uses concurrency 1/5/10/20, a 15 second warm-up, a 60 second steady state, three repeats, and four scenarios. It can take several minutes and writes only to an isolated application-state database inside the run directory.

The real provider command is intentionally separate and requires both an ignored private suite and an explicit confirmation flag:

```powershell
npm.cmd --prefix backend run performance:real -- `
  --suite backend/evaluation/performance/private/suite.json `
  --label baseline-v1 --confirm-real-api
```

Review the estimated request count and API cost before running it. Do not put the private suite or raw output into GitHub.

## Metrics

The harness records JSON and SSE total latency (P50/P95/P99), TTFB, first SSE event, first content chunk, throughput, success/error/timeout/rate-limit rates, stage timings, retrieval Recall@5 and MRR@10 when relevance labels exist, and optional Windows process CPU/working-set samples. P99 is marked reference-only below 100 observations. Direct and KG retrieval metrics are `null`, not zero, because those modes do not execute document retrieval.

`report.public.md` and `summary.public.json` are allowlist projections. They contain aggregate metadata, hashes, thresholds, anonymous error categories, and limitations. `report.private.md`, `summary.private.json`, and `observations.private.jsonl` are local diagnostics and must remain private.

Synthetic smoke numbers validate the harness and protocol only. Remote DeepSeek latency depends on network and provider load, so it must be reported as an environment-specific observation rather than a model or infrastructure claim.

