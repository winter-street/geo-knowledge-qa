# Agent Performance Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a privacy-safe, repeatable evaluation and load-testing harness for Direct, RAG, KG, Hybrid, and Agent modes, then generate a local `baseline-v1` report.

**Architecture:** Keep the existing public synthetic evaluation v1 unchanged. Add a focused `performance` module for five-mode matrices, monotonic client/server timing, deterministic OpenAI-compatible stubbing, load execution, process sampling, threshold evaluation, and private/public reports. Performance diagnostics are emitted only when `PERF_TEST_MODE=true`; normal API responses remain compatible.

**Tech Stack:** Node.js 22.18, TypeScript, Express 4, native `fetch`, `node:perf_hooks`, Zod, PowerShell process inspection, existing LangGraph.js/Flask/Neo4j stack.

## Global Constraints

- Do not commit, push, create a branch, or create a Pull Request unless the user explicitly asks.
- Do not read private question text into public output or stage real PDF, SQLite, model, coordinate, credential, or raw answer files.
- Preserve the existing public synthetic evaluation v1 and its generated artifacts.
- Use test-driven development and run the narrow test before each broader verification.
- Real DeepSeek evaluation is a separate explicit command and never runs in CI.
- Local load tests use an isolated backend port and isolated app-state database.
- Runtime versions remain Node.js 22.18, Python 3.10, and Neo4j 5.26.4.

---

### Task 1: Performance Types, Statistics, and Five-Mode Matrix

**Files:**
- Create: `backend/src/services/performance/types.ts`
- Create: `backend/src/services/performance/statistics.ts`
- Create: `backend/src/services/performance/matrix.ts`
- Test: `backend/src/services/performance/statistics.test.ts`
- Test: `backend/src/services/performance/matrix.test.ts`

**Interfaces:**
- Produces: `PERFORMANCE_MODES`, `PerformanceMode`, `BenchmarkCase`, `RequestObservation`, `ModeSummary`, `PerformanceRun`.
- Produces: `percentile(values, quantile)`, `bootstrapDifference(left, right, options)`, `buildEvaluationMatrix(cases, modes)`.

- [ ] **Step 1: Write failing statistics tests**

```ts
assert.equal(percentile([10, 20, 30, 40], 0.5), 20)
assert.equal(percentile([10, 20, 30, 40], 0.95), 40)
const ci = bootstrapDifference([0.7, 0.8, 0.9], [0.4, 0.5, 0.6], { iterations: 500, seed: 7 })
assert.ok(ci.lower > 0)
```

- [ ] **Step 2: Run statistics test and verify missing-module failure**

Run: `npm --prefix backend exec -- tsx src/services/performance/statistics.test.ts`

Expected: FAIL because `statistics.ts` does not exist.

- [ ] **Step 3: Implement deterministic statistics**

Use nearest-rank percentiles and a seeded xorshift32 bootstrap. Reject non-finite inputs, quantiles outside `[0, 1]`, and unequal paired samples.

```ts
export function percentile(values: number[], quantile: number): number
export function bootstrapDifference(
  enhanced: number[], baseline: number[],
  options?: { iterations?: number; seed?: number },
): { meanDifference: number; lower: number; upper: number }
```

- [ ] **Step 4: Write and run five-mode matrix test**

```ts
const matrix = buildEvaluationMatrix([{ id: 'case-1', kind: 'supported' }], PERFORMANCE_MODES)
assert.deepEqual(matrix.map((item) => item.mode), ['direct', 'rag', 'kg', 'hybrid', 'agent'])
assert.equal(new Set(matrix.map((item) => item.caseId)).size, 1)
```

Run: `npm --prefix backend exec -- tsx src/services/performance/matrix.test.ts`

Expected before implementation: FAIL. Expected after implementation: PASS.

- [ ] **Step 5: Define stable observation types**

`RequestObservation` contains IDs and derived measurements only:

```ts
interface RequestObservation {
  runId: string
  requestId: string
  caseId: string
  mode: PerformanceMode
  status: 'success' | 'http_error' | 'timeout' | 'protocol_error' | 'supplier_rate_limit'
  httpStatus?: number
  totalMs: number
  ttfbMs?: number
  firstEventMs?: number
  firstContentMs?: number
  stageTimings?: Record<PerformanceStage, number>
  retrievedDocumentIds: string[]
  citationIds: string[]
  predictedIntent?: AgentIntent
  selectedTools: AgentToolName[]
  linkedEntityId?: string
  refused?: boolean
  totalClaims?: number
  unsupportedClaims?: number
  llmCalls?: number
  inputTokens?: number
  outputTokens?: number
}
```

- [ ] **Step 6: Run narrow tests and backend type check**

Run: `npm --prefix backend exec -- tsx src/services/performance/statistics.test.ts`

Run: `npm --prefix backend exec -- tsx src/services/performance/matrix.test.ts`

Run: `npm --prefix backend run type-check`

Expected: all PASS.

- [ ] **Step 7: Review checkpoint without committing**

Run: `git diff --check -- backend/src/services/performance`

Expected: no whitespace errors.

### Task 2: Request-Scoped Stage Timing

**Files:**
- Create: `backend/src/services/performance/timing.ts`
- Test: `backend/src/services/performance/timing.test.ts`
- Modify: `backend/src/types/index.ts`
- Modify: `backend/src/routes/qa.ts`
- Modify: `backend/src/routes/qa-agent.ts`
- Modify: `backend/src/services/agent/orchestrator.ts`
- Test: `backend/src/routes/qa-agent.test.ts`

**Interfaces:**
- Produces: `PerformanceStage`, `PerformanceDiagnostics`, `createRequestTiming(enabled)`.
- `createRequestTiming` returns `measure(stage, operation)`, `mark(stage, durationMs)`, and `snapshot()`.
- Optional JSON field: `performance?: PerformanceDiagnostics`.
- Optional SSE event: `{ type: 'performance', performance: PerformanceDiagnostics }` immediately before `done`.

- [ ] **Step 1: Write failing timing tests**

Use an injected monotonic clock so tests do not sleep:

```ts
const ticks = [0, 10, 25]
const timing = createRequestTiming(true, () => ticks.shift()!)
const result = await timing.measure('retrieval', async () => 'ok')
assert.equal(result, 'ok')
assert.equal(timing.snapshot().stages.retrieval, 10)
timing.finish()
assert.equal(timing.snapshot().totalMs, 25)
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm --prefix backend exec -- tsx src/services/performance/timing.test.ts`

Expected: FAIL because `timing.ts` does not exist.

- [ ] **Step 3: Implement monotonic timing collector**

Use `performance.now()` by default. Ignore duplicate `finish()` calls, sum repeated stages, round report values to two decimals, and return an empty disabled snapshot when `PERF_TEST_MODE` is false.

- [ ] **Step 4: Add response types and performance-mode gate**

Extend shared backend response types with optional diagnostics only. Enable diagnostics when both conditions hold:

```ts
const perfEnabled = process.env.PERF_TEST_MODE === 'true'
  && typeof req.header('X-Perf-Run-Id') === 'string'
  && typeof req.header('X-Perf-Request-Id') === 'string'
```

No question, prompt, answer, source text, user ID, or credential may enter diagnostics.

- [ ] **Step 5: Instrument direct route from route entry**

Wrap retrieval, rerank, LLM, grounding, and persistence. Move total start to the first line inside the handler so logged latency includes retrieval. In JSON mode attach `performance`; in SSE mode emit `performance` before `done`.

- [ ] **Step 6: Instrument Agent route and orchestration**

Record `intent`, `entity_link`, `planning`, aggregate `tools`, `llm`, `grounding`, and `persistence`. Preserve per-tool `toolTrace`. Chitchat and clarification report zero LLM calls.

- [ ] **Step 7: Extend route contract tests**

Verify three cases:

```ts
// PERF_TEST_MODE off: no performance field/event.
// PERF_TEST_MODE on without trace headers: no performance field/event.
// PERF_TEST_MODE on with both headers: diagnostics exist and contain no question/answer text.
```

- [ ] **Step 8: Run narrow and broad tests**

Run: `npm --prefix backend exec -- tsx src/services/performance/timing.test.ts`

Run: `npm --prefix backend exec -- tsx src/routes/qa-agent.test.ts`

Run: `npm --prefix backend test`

Run: `npm --prefix backend run type-check`

Expected: all PASS.

### Task 3: Deterministic OpenAI-Compatible Model Stub

**Files:**
- Create: `backend/src/services/performance/model-stub.ts`
- Test: `backend/src/services/performance/model-stub.test.ts`
- Create: `backend/scripts/start-performance-model-stub.ts`

**Interfaces:**
- Produces: `createModelStub(options): http.Server`.
- Endpoint: `POST /v1/chat/completions` supporting OpenAI-compatible JSON and SSE responses.
- Control headers: `X-Stub-Scenario`, `X-Stub-First-Token-Ms`, `X-Stub-Token-Interval-Ms`.

- [ ] **Step 1: Write failing model-stub tests**

Start on port `0` and verify:

```ts
// JSON returns choices[0].message.content and usage.
// stream=true returns data: chunks followed by data: [DONE].
// scenario=rate_limit returns 429 and Retry-After.
// scenario=unauthorized returns 401.
// scenario=timeout exceeds the configured client timeout.
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm --prefix backend exec -- tsx src/services/performance/model-stub.test.ts`

Expected: FAIL because the stub does not exist.

- [ ] **Step 3: Implement the stub**

Default deterministic response contains valid synthetic citations only. Tool-call requests return deterministic `tool_calls` matching the supplied tool definitions. The stub never echoes prompts or authorization headers.

- [ ] **Step 4: Add CLI**

CLI options:

```text
--port 4010
--first-token-ms 300
--token-interval-ms 20
--scenario success|unauthorized|rate_limit|server_error|disconnect|timeout
```

- [ ] **Step 5: Run tests and type check**

Run: `npm --prefix backend exec -- tsx src/services/performance/model-stub.test.ts`

Run: `npm --prefix backend run type-check`

Expected: PASS.

### Task 4: JWT-Aware JSON/SSE Load Client and Resource Sampling

**Files:**
- Create: `backend/src/services/performance/http-client.ts`
- Create: `backend/src/services/performance/load-runner.ts`
- Create: `backend/src/services/performance/process-sampler.ts`
- Test: `backend/src/services/performance/http-client.test.ts`
- Test: `backend/src/services/performance/load-runner.test.ts`
- Test: `backend/src/services/performance/process-sampler.test.ts`

**Interfaces:**
- Produces: `login(baseUrl, credentials)`, `askJson(input)`, `askSse(input)`.
- Produces: `runLoadScenario(config, clientFactory)` with closed concurrency and per-virtual-user state.
- Produces: `sampleWindowsProcesses(targets)` returning CPU time and working-set bytes.

- [ ] **Step 1: Write SSE parser tests**

Feed deliberately split UTF-8 chunks and verify `meta`, `plan`, `tool_start`, `tool_end`, `chunk`, `performance`, and `done` are parsed without losing boundaries. Missing `done`, invalid JSON, duplicate terminal events, and aborts must return `protocol_error`.

- [ ] **Step 2: Implement client timing**

Use `performance.now()` for request start, headers, first event, first non-empty chunk, and completion. Classify HTTP 429 as `supplier_rate_limit`; distinguish client timeout from server 5xx.

- [ ] **Step 3: Write load-runner tests**

With a fake client, verify exact concurrency, isolated conversation IDs, 15-second warmup exclusion, 60-second steady-state inclusion, and cancellation of all workers after the deadline. Tests use injected clocks with millisecond-scale durations.

- [ ] **Step 4: Implement four scenarios**

Scenario IDs:

```ts
type ScenarioId = 'hybrid-json' | 'agent-json' | 'agent-sse' | 'agent-multiturn'
```

Each virtual user logs in once, uses a unique username fixture or JWT, and uses a unique conversation ID. Multi-turn preserves its own ID for exactly three sequential turns.

- [ ] **Step 5: Implement Windows process sampling**

Read explicitly supplied PIDs with `Get-Process -Id`; never enumerate command lines or environment variables. Convert `TotalProcessorTime` deltas to CPU percentage and capture `WorkingSet64`. Missing processes produce a structured unavailable sample instead of failing the run.

- [ ] **Step 6: Run tests**

Run: `npm --prefix backend exec -- tsx src/services/performance/http-client.test.ts`

Run: `npm --prefix backend exec -- tsx src/services/performance/load-runner.test.ts`

Run: `npm --prefix backend exec -- tsx src/services/performance/process-sampler.test.ts`

Run: `npm --prefix backend run type-check`

Expected: all PASS.

### Task 5: Aggregation, Thresholds, Privacy, and Reports

**Files:**
- Create: `backend/src/services/performance/aggregate.ts`
- Create: `backend/src/services/performance/privacy.ts`
- Create: `backend/src/services/performance/report.ts`
- Test: `backend/src/services/performance/aggregate.test.ts`
- Test: `backend/src/services/performance/privacy.test.ts`
- Test: `backend/src/services/performance/report.test.ts`

**Interfaces:**
- Produces: `aggregateRun(input): PerformanceSummary`.
- Produces: `sanitizePublicSummary(input): PublicPerformanceSummary`.
- Produces: `renderPrivateReport(summary)`, `renderPublicReport(summary)`.
- Produces: `renderBlindReviewCsv(observations)` with randomized answer order and hidden mode labels.

- [ ] **Step 1: Write aggregation threshold tests**

Verify P50/P95/P99, throughput, error/timeout rates, concurrency scaling, SSE timing, memory recovery, baseline regression, per-mode quality, and 95% confidence intervals. Direct and KG retrieval metrics must be `null`, never zero.

- [ ] **Step 2: Implement aggregation**

Apply the design thresholds exactly. Supplier 429 is excluded from local error rate but included in raw availability. P99 is marked `referenceOnly: true` when fewer than 100 samples exist.

- [ ] **Step 3: Write privacy tests with canaries**

Insert canaries for question text, document title, evidence excerpt, coordinates, API key, password, JWT, username, prompt, answer, and stack trace. Assert none occur in serialized public output.

- [ ] **Step 4: Implement allowlist-based public projection**

Do not redact arbitrary private objects. Construct `PublicPerformanceSummary` from an explicit allowlist of run metadata, counts, hashes, aggregated metrics, threshold results, anonymous error categories, and known limitations.

- [ ] **Step 5: Implement reports**

Generate `manifest.json`, private JSONL/JSON/Markdown, and public JSON/Markdown. Public report begins with a statement that synthetic results are harness validation and remote model latency is environment-dependent.

Generate `blind-review.private.csv` for two independent reviewers. It contains randomized sample IDs, question, answer, allowed evidence, task-completion score, citation-support score, and notes, but hides the mode until both reviews are complete. Disagreements are adjudicated before a result is marked `humanBlindReview: complete`.

- [ ] **Step 6: Run tests and secret scan**

Run: `npm --prefix backend exec -- tsx src/services/performance/aggregate.test.ts`

Run: `npm --prefix backend exec -- tsx src/services/performance/privacy.test.ts`

Run: `npm --prefix backend exec -- tsx src/services/performance/report.test.ts`

Run: `powershell -ExecutionPolicy Bypass -File scripts/scan-secrets.ps1 -Root .`

Expected: all PASS.

### Task 6: Commands, Isolation, Documentation, and Baseline Run

**Files:**
- Create: `backend/scripts/run-performance.ts`
- Create: `backend/evaluation/performance/README.md`
- Create: `backend/evaluation/performance/suite.example.json`
- Create: `backend/evaluation/performance/load-questions.json`
- Modify: `backend/package.json`
- Modify: `.gitignore`
- Modify: `scripts/verify.ps1`
- Test: `backend/src/services/performance/cli.test.ts`

**Interfaces:**
- Commands: `performance:smoke`, `performance:local`, `performance:real`, `performance:report`.

- [ ] **Step 1: Write CLI contract test**

Verify `--help`, invalid mode rejection, refusal to run `real` without `--confirm-real-api`, output path containment, and refusal to publish when privacy scan fails.

- [ ] **Step 2: Implement command modes**

```text
npm --prefix backend run performance:smoke
npm --prefix backend run performance:local -- --label baseline-v1
npm --prefix backend run performance:real -- --suite backend/evaluation/performance/private/suite.json --label baseline-v1 --confirm-real-api
npm --prefix backend run performance:report -- --run backend/evaluation/performance/output/baseline-v1
```

`smoke` uses synthetic fixtures and short injected-clock scenarios. `local` uses the tracked general-geology load question pool and requires healthy Flask/Neo4j plus the local model stub. `real` requires the ignored private suite, DeepSeek configuration, and prints an estimated request count before starting.

- [ ] **Step 3: Isolate outputs**

Private output root: `backend/evaluation/performance/output/`.

Private suite root: `backend/evaluation/performance/private/`.

Public synthetic fixtures: `backend/evaluation/performance/public/`.

Add the private output and private suite roots to `.gitignore`. Do not ignore public deterministic fixtures or `load-questions.json`; the tracked questions contain only generic geology prompts and no real titles, evidence, coordinates, or answers.

- [ ] **Step 4: Add verification coverage**

Add deterministic performance unit and smoke tests to the backend test discovery. Do not run load or real API tests from `scripts/verify.ps1`.

- [ ] **Step 5: Document operation and interpretation**

README includes prerequisites, exact commands, runtime estimates, API-cost warning, metric definitions, privacy boundaries, and the rule that `baseline-v1` is not a GPU/inference-engine benchmark.

- [ ] **Step 6: Run repository verification**

Run: `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1`

Expected: all checks PASS.

- [ ] **Step 7: Run local synthetic smoke baseline**

Run: `npm --prefix backend run performance:smoke`

Expected: a privacy-safe synthetic report and no raw private content.

- [ ] **Step 8: Run private local baseline**

Run against the current private Flask/Neo4j services and the local model stub:

`npm --prefix backend run performance:local -- --label baseline-v1`

Expected: private observations plus public aggregate report, with pass/fail status for every local threshold.

- [ ] **Step 9: Stop before paid real run unless explicitly confirmed**

Print the estimated number of DeepSeek calls and wait for explicit approval before `performance:real`. The implementation is complete without consuming paid API calls.

- [ ] **Step 10: Final review checkpoint without committing**

Run: `git diff --check`

Run: `git status --short`

Expected: only planned files plus pre-existing user changes; no private suite or output is staged.
