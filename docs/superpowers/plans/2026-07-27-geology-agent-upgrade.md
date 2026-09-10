# Geological Investigation Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Every behavior change follows test-driven development.

**Goal:** Upgrade the geological RAG and knowledge-graph application into a traceable, multi-turn, evidence-grounded single Agent suitable for an AI application engineering portfolio.

**Architecture:** Keep the Vue, Express, Flask, SQLite and Neo4j boundaries. Add a bounded TypeScript Agent state graph over the existing retrieval services, store application conversation state separately from the private retrieval database, expose sanitized tool traces over the existing Q&A API, and keep all real documents, credentials and raw model outputs private.

**Tech Stack:** TypeScript, Express, LangGraph.js, Zod, better-sqlite3, Vue 3, Flask, sentence-transformers, Neo4j, Vitest, node:test, pytest, GitHub Actions.

## Global Constraints

- Work only in `D:/1GISwork/6-GISdevelop/.worktrees/geology-agent-upgrade` on branch `codex/geology-agent-upgrade`.
- Do not copy, expose or commit real document titles, original excerpts, API keys, passwords, database contents, exact private coordinates or private course materials.
- Public examples use synthetic geological names, documents, graph relations and coordinates, explicitly marked `isMock` or `synthetic`.
- Preserve backward compatibility for `POST /api/qa/ask` and existing `meta -> chunk -> done` SSE clients.
- Do not persist hidden chain-of-thought. Tool traces contain only tool name, validated argument summary, status, latency and evidence count.
- The Agent executes at most three tools per turn, each tool has a 10 second timeout, and the whole run has a 60 second timeout.
- Short-term memory uses the latest six turns, a rolling summary and active linked entities; no vector long-term user memory is added.
- Single Agent only. Dify is an optional client of the same HTTP tool capability and is not a runtime dependency.
- Pin Node.js 22.18 and document Python 3.10. New functions and behavior changes require a failing test before implementation.

---

### Task 1: Reproducible Engineering Baseline

**Deliverable:** A fresh checkout has pinned runtimes, one verification entry point, complete test scripts, CI, secret scanning and a privacy-safe data snapshot manifest.

**Files:**
- Modify root and package manifests, ignore rules and existing test scripts.
- Create `.nvmrc`, `.python-version`, `scripts/verify.ps1`, `scripts/scan-secrets.ps1`, `scripts/generate-data-manifest.py`, `.github/workflows/ci.yml`, and manifest tests.

**Requirements:**
- Root `npm run verify` invokes backend type checking/tests, frontend type checking/all tests, focused Python unit tests and secret scanning.
- Backend gets a real test script covering every `src/**/*.test.ts`; frontend test script covers every `src/**/*.test.ts` and `src/**/*.test.tsx`, not only two files.
- Secret scanning fails for DeepSeek, AMap, generic bearer/private-key patterns and forbidden private runtime paths, while accepting `.env.example` placeholders.
- Manifest output contains only document count, chunk count, vector dimension, ontology instance count, generated timestamp/version and SHA-256 hashes. It must never contain document titles or text.
- CI uses Node 22 and Python 3.10 and runs verification without real keys or real data.

### Task 2: Agent Domain Model, Intent, Entity Linking and Persistence

**Deliverable:** Independently tested Agent domain services support structured intent, entity linking, query rewriting, six-turn memory and isolated application persistence.

**Files:**
- Create focused modules under `backend/src/services/agent/` and `backend/src/db/app-state.ts`.
- Extend shared backend types without duplicating local types.

**Interfaces:**
- `AgentIntent = 'geology_qa' | 'entity_lookup' | 'spatial_analysis' | 'region_comparison' | 'chitchat' | 'clarification'`.
- `LinkedEntity` includes `id`, `name`, `type`, `confidence`, `matchedBy` and `disambiguation`.
- `AgentMemory` includes `recentMessages` limited to six turns, `summary`, and `activeEntities`.
- Persistence stores conversations, messages, rolling state, Agent runs and tool calls in `backend/data/app.db`, separate from `ml-service/output/geo_knowledge.db`.

**Requirements:**
- Follow-up rewriting resolves pronouns and omissions from active entities but leaves standalone questions unchanged.
- Entity linking combines aliases, KG candidates and recent context, returns deterministic confidence ordering, and requests clarification for ambiguous top candidates.
- JWT user identity scopes every persisted conversation read/write.
- Persist only sanitized metadata in tool calls; never store raw hidden reasoning.

### Task 3: Bounded LangGraph Agent and Q&A API Integration

**Deliverable:** A single Agent state graph plans and calls typed tools, streams safe execution events, persists memory and remains compatible with direct Q&A mode.

**Files:**
- Create Agent graph, planner, tool registry and trace modules under `backend/src/services/agent/`.
- Modify the existing Q&A route, LLM provider interfaces and frontend Q&A API/store/types.

**Interfaces:**
- Tools: `search_documents`, `query_knowledge_graph`, `spatial_query`, `get_entity_detail`, all validated with Zod.
- Request additions: `conversationId?`, `agentMode?: 'direct' | 'agent'`, existing `question`, `retrievalMode?`, `stream?` retained.
- Response additions: `conversationId`, `intent`, `linkedEntities`, `citations`, `toolTrace`.
- SSE additions: `plan`, `tool_start`, `tool_end`; existing `meta`, `chunk`, `done`, `error` remain authoritative and ordered.

**Requirements:**
- Planner exposes a short declarative step list, never chain-of-thought.
- At most three validated tools run; independent tools may execute concurrently.
- Tool timeout is 10 seconds and run timeout is 60 seconds; timeout/failure produces trace events and degrades to available evidence.
- Existing requests without `agentMode` keep current direct behavior.
- Frontend renders a compact execution timeline and continues to work with servers that omit all new fields.

### Task 4: Retrieval Quality, Reranking and Evidence-Grounded Answers

**Deliverable:** Document evidence is deduplicated, diversified, optionally cross-encoder reranked, cited at claim level and checked before final delivery.

**Files:**
- Extend the Flask search service with an optional rerank endpoint and focused tests.
- Add backend evidence selection, citation and grounding modules; integrate them into direct and Agent answer paths.

**Interfaces:**
- Retrieve up to 20 candidates and retain five evidence items.
- Reranker uses `BAAI/bge-reranker-base` when available and returns an explicit fallback status when unavailable.
- Citations identify only sanitized document/page IDs (`[D{id}-P{page}]`) or KG path IDs (`[KG{id}]`) and map to returned evidence metadata.

**Requirements:**
- Exact/near duplicate chunks are removed and no document contributes more than two of five final chunks.
- Reranker timeout or model failure falls back to the existing deterministic reranker.
- Factual answers without supporting evidence are refused or clarified; unsupported factual sentences are not silently retained.
- Preserve Direct, RAG, KG, Hybrid and Agent evaluation modes.

### Task 5: Reproducible Evaluation and Acceptance Metrics

**Deliverable:** Privacy-safe evaluation assets measure retrieval, intent, entity linking, tool routing, citations, refusal, multi-turn success and latency with deterministic reports.

**Files:**
- Create sanitized evaluation schemas, metric calculators, fixture generators and reports under `backend/evaluation/public/` and `backend/src/services/evaluation/`.
- Extend the groundedness benchmark without committing raw model answers.

**Requirements:**
- Define 80 single-turn cases (60 supported, 20 refusal) and 20 three-turn multi-turn conversations using synthetic/anonymized entities.
- Separate development and test splits; reports state which split was used.
- Calculate Recall@5, MRR@10, intent accuracy, tool-selection accuracy, entity-link Top-1 accuracy, citation precision, refusal false-answer rate, multi-turn task success, unsupported-claim rate and orchestration latency percentiles.
- Acceptance thresholds: Recall@5 >= 0.80, MRR@10 >= 0.70, intent/tool accuracy >= 0.90, entity Top-1 >= 0.85, citation precision >= 0.90, refusal false-answer <= 0.10, multi-turn success >= 0.80, unsupported claims <= 0.35 and at least 0.20 absolute improvement over direct answers.
- Reports clearly label automated judging as auxiliary and leave a human blind-review field for final test cases.

### Task 6: Synthetic Public Demo, Dify Workflow and Portfolio Documentation

**Deliverable:** A reviewer can run a complete privacy-safe demo and understand the architecture, tool timeline, evaluation limits and resume claims.

**Files:**
- Create a deterministic synthetic data generator and 5-8 synthetic source documents plus graph/spatial fixtures.
- Create a Dify DSL workflow that calls the public backend capability without embedding credentials.
- Replace placeholder README content and add deployment/demo documentation.

**Requirements:**
- Synthetic entities use clearly fictional names and coordinates and are marked `synthetic`/`isMock` end to end.
- One command prepares and starts the demo without real documents or real API keys; deterministic fallback answers work without an LLM key.
- README includes architecture, tool execution sequence, three multi-turn examples, evaluation table, privacy policy, limitations and troubleshooting.
- Resume guidance uses “professional geological documents” and “reproducible evaluation framework”; numerical claims are read from the generated snapshot and are not described as proof until human review passes.
- Final verification includes fresh-clone-equivalent install, complete automated test suite, synthetic demo health check and repository secret/privacy scan.
