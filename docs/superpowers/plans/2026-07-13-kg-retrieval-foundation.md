# KG Retrieval Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 修复 KG 查询质量和区域数据基础，并让 KG 证据在不突破语义门槛的前提下对 BGE 候选进行可解释重排。

**Architecture:** `kg-query-analysis.ts` 负责纯文本分析，`kg-ranking.ts` 负责纯路径评分和名额分配，`kg.ts` 只负责 Neo4j I/O。`rag-reranker.ts` 在 BGE 与 KG 并行返回后执行融合；Python 脚本独立负责可回滚的演示区域数据，前端只消费统一的 `KGPath` 来源字段。

**Tech Stack:** TypeScript 5.5、Node.js 20+、Express、neo4j-driver 5.25、tsx 断言测试、Python 3.10+、unittest、Vue 3、Vitest。

## Global Constraints

- BGE 是主检索器，KG 融合权重固定为 20%，TF-IDF 只保持兼容。
- KG 主查询每个问题只允许一次 `session.run()`，最多返回 60 条候选、10 条最终路径、2 条 OWL 补充。
- BGE 候选数为 `max(topK * 3, 15)`，最低语义门槛为 `max(0.04, bestBgeScore * 0.45)`。
- 演示数据来源固定为 `spatial-demo-v1`；不覆盖真实节点的 `lng`、`lat`、`isMock`。
- 演示关系必须显示“演示知识关系，不作为实际勘查结论”。
- 不导入外围卫星点，只导入十个区域、43 个锚点矿床及其直接引用实体。
- 不改动或提交工作区现有 DOCX、PPT、assets 和教师文档生成脚本。

---

## File Map

- Create `backend/src/services/kg-query-analysis.ts`: 分词结果清理、区域词和关系意图识别。
- Create `backend/src/services/kg-query-analysis.test.ts`: 查询分析断言。
- Create `backend/src/services/kg-ranking.ts`: KG 候选评分、去重、OWL 名额分配。
- Create `backend/src/services/kg-ranking.test.ts`: 排序与稳定性断言。
- Modify `backend/src/services/kg.ts`: 单次组合 Cypher 和候选映射。
- Create `backend/src/services/kg-query.test.ts`: 注入假 session 验证一次查询及参数。
- Create `backend/src/services/rag-reranker.ts`: 语义门槛、KG 支持度和融合重排。
- Create `backend/src/services/rag-reranker.test.ts`: 融合和降级断言。
- Create `backend/src/services/retrieval-fusion.ts`: 将扩召、重排和管理员权重组合为纯编排函数。
- Create `backend/src/services/retrieval-fusion.test.ts`: 混合、RAG-only 和 KG-only 编排断言。
- Modify `backend/src/routes/qa.ts`: 扩召、并行检索后融合、最终 Top-K。
- Modify `backend/src/services/llm.ts`: KG 来源与演示免责声明 Prompt。
- Create `backend/src/services/llm.test.ts`: Prompt 来源断言。
- Modify `backend/src/types/index.ts`: KGPath、评分原因、RAG 分数字段。
- Modify `frontend/src/types/index.ts`: 同步 KGPath 可选字段。
- Create `frontend/src/utils/kg-evidence.ts`: 演示来源摘要纯函数。
- Create `frontend/src/utils/kg-evidence.test.ts`: 前端来源摘要断言。
- Modify `frontend/src/components/ChatMessage.vue`: 演示关系标签和免责声明。
- Create `ml-service/test_run_pipeline_reasoning.py`: OWL 分类写回回归测试。
- Modify `ml-service/scripts/run_pipeline.py`: 同时传递关系和分类。
- Create `ml-service/scripts/spatial_demo_kg_data.py`: 十个区域和 43 个锚点固定清单。
- Create `ml-service/scripts/import_spatial_demo_kg.py`: 幂等导入、验证和清理 CLI。
- Create `ml-service/test_import_spatial_demo_kg.py`: 假 Neo4j session 的导入安全测试。

---

### Task 1: 修复 OWL 分类写回

**Files:**
- Create: `ml-service/test_run_pipeline_reasoning.py`
- Modify: `ml-service/scripts/run_pipeline.py`

**Interfaces:**
- Consumes: `run_reasoning() -> {"relations": list, "classifications": dict}`
- Produces: `write_reasoning_results(write_fn, reason_stats)`，统一把两个结果传给写回函数。

- [x] **Step 1: Write the failing test**

```python
import importlib.util
from pathlib import Path
from unittest import TestCase
from unittest.mock import Mock


class PipelineReasoningWritebackTest(TestCase):
    def test_passes_relations_and_classifications(self):
        path = Path(__file__).parent / "scripts" / "run_pipeline.py"
        spec = importlib.util.spec_from_file_location("run_pipeline", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        writer = Mock()
        stats = {"relations": [{"from": "A"}], "classifications": {"RockHostedMineral": ["A"]}}

        module.write_reasoning_results(writer, stats)

        writer.assert_called_once_with(stats["relations"], stats["classifications"])
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd ml-service; python -m unittest test_run_pipeline_reasoning.py -v`

Expected: FAIL with `AttributeError: module 'run_pipeline' has no attribute 'write_reasoning_results'`.

- [x] **Step 3: Write minimal implementation**

```python
def write_reasoning_results(write_fn, reason_stats):
    write_fn(reason_stats["relations"], reason_stats["classifications"])
```

Replace the direct call in Step 6 with:

```python
write_reasoning_results(write_to_neo4j, reason_stats)
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd ml-service; python -m unittest test_run_pipeline_reasoning.py -v`

Expected: `Ran 1 test ... OK`.

- [x] **Step 5: Commit**

```bash
git add ml-service/test_run_pipeline_reasoning.py ml-service/scripts/run_pipeline.py
git commit -m "修复：完整写回OWL推理分类"
```

---

### Task 2: 实现 KG 问题分析

**Files:**
- Create: `backend/src/services/kg-query-analysis.ts`
- Create: `backend/src/services/kg-query-analysis.test.ts`

**Interfaces:**
- Consumes: `question: string`、现有 `tokenize(question): string[]`
- Produces: `analyzeKgQuestion(question): KGQueryAnalysis`

- [x] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict'
import { analyzeKgQuestion } from './kg-query-analysis.js'

const result = analyzeKgQuestion('攀西钒钛磁铁矿受什么构造控制？', [
  '攀西', '钒钛磁铁矿', '受', '什么', '构造', '控制',
])
assert.deepEqual(result.regionTerms, ['攀西'])
assert.deepEqual(result.entityTerms, ['钒钛磁铁矿'])
assert.deepEqual(result.relationIntents, ['CONTROLLED_BY'])
assert.equal(result.keywords.includes('什么'), false)

const longest = analyzeKgQuestion('钒钛磁铁矿和钒钛', ['钒钛磁铁矿', '钒钛'])
assert.deepEqual(longest.keywords, ['钒钛磁铁矿'])
console.log('[PASS] KG query analysis')
```

测试签名允许第二参数注入 token，生产调用省略第二参数时使用 `tokenize()`，从而让测试不依赖本机 nodejieba 分词差异。

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend; npx tsx src/services/kg-query-analysis.test.ts`

Expected: FAIL with module not found.

- [x] **Step 3: Write minimal implementation**

```ts
export type KGRelationType = 'HOSTED_IN' | 'CONTROLLED_BY' | 'FORMED_IN' | 'LIES_IN'

export interface KGQueryAnalysis {
  keywords: string[]
  entityTerms: string[]
  regionTerms: string[]
  relationIntents: KGRelationType[]
  owlRules: string[]
}

export function analyzeKgQuestion(question: string, suppliedTokens?: string[]): KGQueryAnalysis {
  const tokens = suppliedTokens ?? tokenize(question)
  // 使用固定 STOP_WORDS、REGION_ALIASES、RELATION_INTENT_RULES；
  // 规范化、去重、长词覆盖后最多保留 8 个关键词。
}
```

区域别名必须覆盖规格中的十个区域及 keys；关系意图至少覆盖 `HOSTED_IN`、`CONTROLLED_BY`、`FORMED_IN`、`LIES_IN`，OWL 规则沿用当前三个 `owlType` 名称。

- [x] **Step 4: Run test and type-check**

Run: `cd backend; npx tsx src/services/kg-query-analysis.test.ts; npm run build`

Expected: assertion output `[PASS] KG query analysis` and TypeScript build exit 0.

- [x] **Step 5: Commit**

```bash
git add backend/src/services/kg-query-analysis.ts backend/src/services/kg-query-analysis.test.ts
git commit -m "功能：增加地质KG问题分析"
```

---

### Task 3: 实现 KG 路径评分和名额分配

**Files:**
- Create: `backend/src/services/kg-ranking.ts`
- Create: `backend/src/services/kg-ranking.test.ts`
- Modify: `backend/src/types/index.ts`
- Modify: `frontend/src/types/index.ts`

**Interfaces:**
- Consumes: `rankKgPaths(candidates, analysis, question, limit = 10): KGPath[]`
- Produces: 带 `relationType`、`score`、`scoreReasons`、`source`、`isMock`、`regionContext` 的 `KGPath`。

- [x] **Step 1: Write the failing test**

```ts
const ranked = rankKgPaths([
  path('方铅矿', 'CONTROLLED_BY', '断裂带', { candidateKind: 'owl' }),
  path('攀枝花钒钛磁铁矿', 'CONTROLLED_BY', '攀枝花南北向断裂', { regionContext: '攀西钒钛成矿带' }),
  path('磁铁矿', 'HOSTED_IN', '辉长岩'),
], analysis, '攀西钒钛磁铁矿受什么构造控制')

assert.equal(ranked[0]?.from, '攀枝花钒钛磁铁矿')
assert.equal(ranked[0]?.relationType, 'CONTROLLED_BY')
assert.ok((ranked[0]?.score ?? 0) > (ranked[1]?.score ?? 0))
assert.ok(ranked[0]?.scoreReasons?.some((reason) => reason.code === 'region'))
assert.ok(ranked.filter((item) => item.candidateKind === 'owl').length <= 2)
assert.deepEqual(rankKgPaths(candidates, analysis, question), rankKgPaths(candidates, analysis, question))
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend; npx tsx src/services/kg-ranking.test.ts`

Expected: FAIL with module not found.

- [x] **Step 3: Add shared types and implementation**

```ts
export interface KGPathScoreReason {
  code: 'exact_entity' | 'keyword' | 'region' | 'relation_intent' | 'owl_supplement'
  value: number
  detail: string
}

export interface KGPath {
  from: string
  relation: string
  relationType?: string
  to: string
  score?: number
  scoreReasons?: KGPathScoreReason[]
  inferred?: boolean
  isMock?: boolean
  source?: string
  regionContext?: string
  candidateKind?: 'direct' | 'region' | 'owl'
  // keep existing OWL and coordinate fields
}
```

Implement the exact score table from the spec, deduplicate by `from|relationType|to|source`, sort deterministically, take up to eight main paths first, then no more than two OWL-only paths, and fill unused slots with remaining main paths up to ten.

- [x] **Step 4: Run test and both type-checks**

Run: `cd backend; npx tsx src/services/kg-ranking.test.ts; npm run build; cd ../frontend; npm run type-check`

Expected: ranking assertions pass and both builds exit 0.

- [x] **Step 5: Commit**

```bash
git add backend/src/services/kg-ranking.ts backend/src/services/kg-ranking.test.ts backend/src/types/index.ts frontend/src/types/index.ts
git commit -m "功能：增加KG路径评分与稳定排序"
```

---

### Task 4: 将 KG 检索改为单次组合 Cypher

**Files:**
- Modify: `backend/src/services/kg.ts`
- Create: `backend/src/services/kg-query.test.ts`

**Interfaces:**
- Consumes: `analyzeKgQuestion()`、`rankKgPaths()`
- Produces: `searchEntities(question, entityTypes?) -> Promise<KGPath[]>`，每次调用只执行一次主 `session.run()`。

- [x] **Step 1: Write the failing test around an injectable query executor**

```ts
let calls = 0
const rows = await queryKgCandidates('攀西钒钛磁铁矿受什么构造控制', undefined, async (cypher, params) => {
  calls += 1
  assert.match(cypher, /candidateKind/)
  assert.deepEqual(params.relationIntents, ['CONTROLLED_BY'])
  assert.ok(params.regionTerms.includes('攀西'))
  return fakeNeo4jResult([
    { from: '攀枝花钒钛磁铁矿', relationType: 'CONTROLLED_BY', to: '攀枝花南北向断裂', candidateKind: 'region' },
  ])
})
assert.equal(calls, 1)
assert.equal(rows[0]?.regionContext, '攀西钒钛成矿带')
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend; npx tsx src/services/kg-query.test.ts`

Expected: FAIL because `queryKgCandidates` is not exported.

- [x] **Step 3: Implement one parameterized Cypher**

The query must use `CALL { ... UNION ALL ... }` for direct, region and OWL candidate pools, exclude documents/rejected entities/references, return raw `relationType`, provenance fields and `regionContext`, then `ORDER BY candidatePriority, from, relationType, to LIMIT 60`.

```ts
export async function queryKgCandidates(
  question: string,
  entityTypes: GeoEntityType[] | undefined,
  run: KgQueryRunner,
): Promise<KGPathCandidate[]> {
  const analysis = analyzeKgQuestion(question)
  const result = await run(COMBINED_KG_CYPHER, {
    keywords: analysis.keywords,
    regionTerms: analysis.regionTerms,
    relationIntents: analysis.relationIntents,
    owlRules: analysis.owlRules,
    entityTypes: entityTypes ?? [],
  })
  return mapCandidateRecords(result.records)
}
```

`searchEntities()` opens one session, delegates to `queryKgCandidates()`, calls `rankKgPaths()`, and closes the session in `finally`.

- [x] **Step 4: Run focused tests, build and live timing probe**

Run: `cd backend; npx tsx src/services/kg-query-analysis.test.ts; npx tsx src/services/kg-ranking.test.ts; npx tsx src/services/kg-query.test.ts; npm run build`

Expected: all assertions and build pass. With Neo4j running, execute the existing KG-only API probe three times and record that the main query returns relevant Panxi paths without one database call per keyword.

- [x] **Step 5: Commit**

```bash
git add backend/src/services/kg.ts backend/src/services/kg-query.test.ts
git commit -m "优化：合并KG检索并优先返回问题实体"
```

---

### Task 5: 导入可回滚的十区域演示 KG 数据

**Files:**
- Create: `ml-service/scripts/spatial_demo_kg_data.py`
- Create: `ml-service/scripts/import_spatial_demo_kg.py`
- Create: `ml-service/test_import_spatial_demo_kg.py`

**Interfaces:**
- Consumes: `REGIONS` 固定清单、`config.NEO4J_CONFIG`
- Produces: `import_demo_kg(driver) -> stats`、`verify_demo_kg(driver) -> stats`、`remove_demo_kg(driver) -> stats`。

- [x] **Step 1: Write the failing tests**

```python
class DemoKgImportTest(TestCase):
    def test_manifest_has_ten_regions_and_43_anchors(self):
        self.assertEqual(len(REGIONS), 10)
        self.assertEqual(sum(len(region["anchors"]) for region in REGIONS), 43)

    def test_relationship_merge_is_source_scoped(self):
        session = RecordingSession()
        import_demo_kg(FakeDriver(session))
        relationship_queries = [q for q, _ in session.calls if "MERGE (a)-[r:" in q]
        self.assertTrue(relationship_queries)
        self.assertTrue(all("source: $source" in q for q in relationship_queries))

    def test_cleanup_targets_only_demo_source(self):
        session = RecordingSession()
        remove_demo_kg(FakeDriver(session))
        self.assertTrue(all(params.get("source") == "spatial-demo-v1" for _, params in session.calls))
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd ml-service; python -m unittest test_import_spatial_demo_kg.py -v`

Expected: FAIL with missing modules.

- [x] **Step 3: Create the fixed manifest**

Transcribe all ten region names and all 43 anchor rows from `backend/src/data/spatial-mock.ts`. Each anchor record contains exactly:

```python
{
    "name": "攀枝花钒钛磁铁矿",
    "mock_lng": 101.72,
    "mock_lat": 26.56,
    "host_rock": "层状辉长岩",
    "structure": "攀枝花南北向断裂",
    "time_period": "晚二叠世",
    "deposit_type": "岩浆分异型",
}
```

Do not copy `satellites`, generated point ids or generated coordinates.

- [x] **Step 4: Implement transactional import, verification and cleanup**

Use node `MERGE` by label/name with `ON CREATE SET n.isMock=true, n.source=$source`; only set `mockLng/mockLat` for newly created demo anchors or where those mock fields are absent. Use source-scoped relationship MERGE:

```cypher
MATCH (a {name: $from_name}), (b {name: $to_name})
MERGE (a)-[r:LIES_IN {source: $source}]->(b)
SET r.isMock = true, r.display = $display
```

The CLI supports `--action import|verify|remove`; import each region in one managed write transaction. Cleanup first deletes demo relationships, then deletes only source-scoped mock nodes with no remaining relationships.

- [x] **Step 5: Run unit tests and import into the running Neo4j**

Run: `cd ml-service; python -m unittest test_import_spatial_demo_kg.py -v; python scripts/import_spatial_demo_kg.py --action import; python scripts/import_spatial_demo_kg.py --action verify; python scripts/import_spatial_demo_kg.py --action import; python scripts/import_spatial_demo_kg.py --action verify`

Expected: unit tests pass; both verification runs report 10 regions, 43 anchor mappings, no increase after the second import, and no real-coordinate overwrite warnings.

- [x] **Step 6: Commit**

```bash
git add ml-service/scripts/spatial_demo_kg_data.py ml-service/scripts/import_spatial_demo_kg.py ml-service/test_import_spatial_demo_kg.py
git commit -m "数据：导入可回滚的区域演示知识关系"
```

---

### Task 6: 显示 KG 来源并约束 Prompt

**Files:**
- Modify: `backend/src/services/llm.ts`
- Create: `backend/src/services/llm.test.ts`
- Create: `frontend/src/utils/kg-evidence.ts`
- Create: `frontend/src/utils/kg-evidence.test.ts`
- Modify: `frontend/src/components/ChatMessage.vue`

**Interfaces:**
- Consumes: `KGPath.isMock/source/inferred`
- Produces: Prompt 中的来源说明和前端 `summarizeKgProvenance(paths)`。

- [x] **Step 1: Write failing backend Prompt test**

```ts
const prompt = buildPrompt('攀枝花矿床在哪里', [], [{
  from: '攀枝花钒钛磁铁矿', relation: '位于', relationType: 'LIES_IN',
  to: '攀西钒钛成矿带', isMock: true, source: 'spatial-demo-v1',
}], 'kg')
assert.match(prompt, /演示知识关系，不作为实际勘查结论/)
assert.match(prompt, /spatial-demo-v1/)
```

- [x] **Step 2: Write failing frontend provenance test**

```ts
assert.deepEqual(summarizeKgProvenance([
  { from: 'A', relation: '位于', to: 'B', isMock: true, source: 'spatial-demo-v1' },
  { from: 'C', relation: '受控于', to: 'D', inferred: true },
]), { mockCount: 1, inferredCount: 1, hasMock: true })
```

- [x] **Step 3: Run tests to verify they fail**

Run: `cd backend; npx tsx src/services/llm.test.ts; cd ../frontend; npx vitest run src/utils/kg-evidence.test.ts`

Expected: backend assertion fails and frontend module is missing.

- [x] **Step 4: Implement Prompt and UI provenance**

`buildPrompt()` appends `[来源：演示关系 spatial-demo-v1]` to mock paths and adds the exact disclaimer whenever any path has `isMock=true`. `ChatMessage.vue` shows an “演示关系” label plus the same disclaimer; inferred paths retain the existing “本体推理” display. Keep score details out of the default UI.

- [x] **Step 5: Run tests and builds**

Run: `cd backend; npx tsx src/services/llm.test.ts; npm run build; cd ../frontend; npx vitest run src/utils/kg-evidence.test.ts; npm run build`

Expected: tests pass and both production builds exit 0.

- [x] **Step 6: Commit**

```bash
git add backend/src/services/llm.ts backend/src/services/llm.test.ts frontend/src/utils/kg-evidence.ts frontend/src/utils/kg-evidence.test.ts frontend/src/components/ChatMessage.vue
git commit -m "功能：标明KG推理与演示关系来源"
```

---

### Task 7: 实现 KG 感知的 BGE 重排

**Files:**
- Create: `backend/src/services/rag-reranker.ts`
- Create: `backend/src/services/rag-reranker.test.ts`
- Modify: `backend/src/services/retrieval-policy.ts`

**Interfaces:**
- Consumes: `rerankRagResults(question, ragResults, kgPaths, topK): RerankedRagResult[]`
- Produces: `rawScore`、`normalizedBgeScore`、`kgSupport`、`finalScore`，并保持 `score` 兼容 Prompt。

- [x] **Step 1: Write the failing tests**

```ts
const reranked = rerankRagResults('攀西钒钛磁铁矿受什么构造控制', [
  rag(1, '普通磁铁矿概述', 0.80),
  rag(2, '攀枝花钒钛磁铁矿受南北向断裂控制', 0.76),
  rag(3, '医学内容包含攀枝花', 0.02),
], [kgPath], 2)
assert.deepEqual(reranked.map((item) => item.chunk.id), [2, 1])
assert.equal(reranked.some((item) => item.chunk.id === 3), false)
assert.ok(reranked[0].kgSupport > 0)

const unchanged = rerankRagResults('磁铁矿', source, [], 5)
assert.deepEqual(unchanged.map((item) => item.chunk.id), source.map((item) => item.chunk.id))
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend; npx tsx src/services/rag-reranker.test.ts`

Expected: FAIL with module not found.

- [x] **Step 3: Implement exact fusion rules**

```ts
const threshold = Math.max(0.04, bestScore * 0.45)
const normalizedBgeScore = rawScore / bestScore
const kgSupport = Math.min(1,
  0.6 * questionEntityCoverage
  + 0.3 * relatedEntityCoverage
  + 0.1 * relationIntentCoverage)
const finalScore = 0.8 * normalizedBgeScore + 0.2 * kgSupport
```

If `kgPaths.length===0`, return the threshold-filtered original BGE order without fusion. Sort fused ties by original rank and chunk id. Return only `topK`.

Update `applyRagWeight()` to preserve the reranker metadata and apply the administrator RAG weight only after fusion, without changing order.

- [x] **Step 4: Run focused and regression tests**

Run: `cd backend; npx tsx src/services/rag-reranker.test.ts; npx tsx src/services/retrieval-policy.test.ts; npm run build`

Expected: reranking, weight regression and build pass.

- [x] **Step 5: Commit**

```bash
git add backend/src/services/rag-reranker.ts backend/src/services/rag-reranker.test.ts backend/src/services/retrieval-policy.ts
git commit -m "功能：使用KG证据重排BGE候选"
```

---

### Task 8: 接入问答路由并完成全链路验证

**Files:**
- Modify: `backend/src/routes/qa.ts`
- Create: `backend/src/services/retrieval-fusion.ts`
- Create: `backend/src/services/retrieval-fusion.test.ts`
- Modify: `docs/superpowers/plans/2026-07-13-kg-retrieval-foundation.md`（勾选执行状态和记录验证结果）

**Interfaces:**
- Consumes: `search(question, candidateTopK, mode)`、`rerankRagResults()`、`applyRagWeight()`
- Produces: JSON/SSE 均返回相同的重排来源和 KG provenance。

- [x] **Step 1: Add a pure orchestration helper and failing test**

Extract `finalizeRetrievalResults(question, ragSearch, kgSearch, policy)` into `backend/src/services/retrieval-fusion.ts`. Test that hybrid mode requests 15 candidates for `topK=5`, returns five after reranking, while rag-only preserves BGE order and kg-only returns no RAG chunks.

```ts
export function ragCandidateTopK(policy: RetrievalPolicy): number {
  return policy.useRag ? Math.max(policy.ragTopK * 3, 15) : 0
}

export function finalizeRetrievalResults(
  question: string,
  ragResults: Array<{ chunk: Chunk; score: number }>,
  kgPaths: KGPath[],
  policy: RetrievalPolicy,
): WeightedRagResult[] {
  const reranked = rerankRagResults(question, ragResults, policy.useKg ? kgPaths : [], policy.ragTopK)
  return applyRagWeight(reranked, policy.ragWeight)
}
```

Run: `cd backend; npx tsx src/services/retrieval-fusion.test.ts`

Expected: FAIL before the helper exists.

- [x] **Step 2: Wire candidate expansion and fusion**

In `qa.ts`, compute:

```ts
const ragCandidateTopK = Math.max(policy.ragTopK * 3, 15)
```

Pass it to Flask while keeping BGE and KG in the same `Promise.all`. After both return, call `rerankRagResults(trimmedQuestion, ragSearch.results, kgSearch.results, policy.ragTopK)`, then `applyRagWeight()`. Low-relevance logic continues to use the original best BGE score and actual KG count.

- [x] **Step 3: Run all automated checks**

Run:

```powershell
cd backend
Get-ChildItem src -Recurse -Filter '*.test.ts' | ForEach-Object { npx tsx $_.FullName; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
npm run build
cd ../frontend
npx vitest run
npm run build
cd ../ml-service
python -m unittest test_run_pipeline_reasoning.py test_import_spatial_demo_kg.py test_server_retrieval_mode.py -v
```

Expected: every assertion/test passes and both builds exit 0.

- [x] **Step 4: Restart services and verify live questions**

With Neo4j, Flask, backend and frontend restarted, ask:

1. `攀西钒钛磁铁矿受什么构造控制？`
2. `攀枝花钒钛磁铁矿赋存在哪类岩石中？`
3. `哪些矿产受构造控制？`
4. `胶东金矿和断裂有什么关系？`
5. `介绍一下完全无关的医学问题。`

Expected: questions 1/2/4 prioritize their region/entity paths and show the demo disclaimer; question 3 contains no more than two broad OWL supplements; question 5 does not receive a demo-based geological conclusion. Repeat question 1 three times and record median KG latency plus a concrete BGE order change in server logs.

- [x] **Step 5: Commit final integration**

```bash
git add backend/src/routes/qa.ts backend/src/services/retrieval-fusion.ts backend/src/services/retrieval-fusion.test.ts docs/superpowers/plans/2026-07-13-kg-retrieval-foundation.md
git commit -m "功能：接入KG增强的BGE问答检索"
```

- [x] **Step 6: Final diff and safety review**

Run: `git diff HEAD~8 --check; git status --short`

Expected: no whitespace errors; only pre-existing unrelated DOCX/PPT/assets changes remain unstaged. Do not push unless the user explicitly requests it.

## Execution Record

- Completed on 2026-07-14 in `codex/kg-retrieval-foundation`.
- Neo4j demo import: 10 regions, 43 anchor mappings, 172 source-scoped relationships; a second import produced the same counts.
- KG live timing after connection warm-up: 11 ms and 10 ms for the combined query; one `session.run()` per question.
- Automated verification: 12 backend assertion files, 23 frontend Vitest assertions, 7 frontend direct TypeScript assertions and 8 Python unittest cases passed.
- Frontend production build and backend TypeScript build passed. Existing Vite third-party pure-annotation and large-chunk warnings remain unchanged.
- Live JSON and SSE answers both include `演示知识关系，不作为实际勘查结论。` when mock KG paths are used.
- Live BGE comparison confirmed a changed Top-5 order: KG support 1.0 promoted relevant chunks while retaining the 45% semantic floor and 20% fusion cap.
- The frontend repository contains mixed test formats, so execution used `npm test` for the two configured Vitest files, targeted Vitest for `kg-evidence.test.ts`, and the existing backend-local `tsx` binary for seven direct assertion files.
