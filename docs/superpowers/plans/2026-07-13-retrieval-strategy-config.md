# 检索策略配置改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将管理员后台的检索配置改为可持久化、可验证并真实控制后续问答执行路径的运行时配置。

**Architecture:** SQLite 保存单行配置；`runtime-settings` 在启动时加载配置并提供经过校验的内存快照；管理接口聚合 Flask、Neo4j、空间数据和离线产物的真实状态；问答路由根据管理员总开关与用户检索模式的交集执行 RAG、KG 和空间检索。Flask `/search` 接受显式 `retrieval_mode`，不再静默从 BGE 降级为 TF-IDF。

**Tech Stack:** TypeScript、Express、better-sqlite3、Python Flask、Vue 3、Element Plus

## Global Constraints

- 保留当前工作区所有未提交的空间分析改动，不覆盖或回退相关文件。
- Mock 空间数据必须标注为演示数据，不得描述为真实勘查结论。
- BERT-NER 与 OWL 只展示离线产物状态，不伪装为每次问答都执行的在线检索器。
- 管理员关闭的路径不能被普通用户请求中的 `retrievalMode` 绕过。
- 保存失败时不更新内存配置；前端保留用户尚未保存的输入。
- 本轮不自动提交，完成后等待用户单独发出中文提交指令。

---

### Task 1: SQLite 配置持久化与字段校验

**Files:**
- Modify: `backend/src/db/sqlite.ts`
- Modify: `backend/src/services/runtime-settings.ts`
- Create: `backend/src/services/runtime-settings.test.ts`

**Interfaces:**
- Produces: `RuntimeSettings`、`RuntimeSettingsInput`、`validateRuntimeSettings(input, current)`、`getRuntimeSettings()`、`updateRuntimeSettings(input, updatedBy)`。
- Produces: `loadRuntimeSettings()` 与 `saveRuntimeSettings(settings)`，使用 `runtime_settings` 单行表。

- [ ] **Step 1: 写失败测试**

测试默认值、完整字段校验、非法权重/模式/Top-K、SQLite 写入后重新读取，以及一次非法更新不会污染当前快照。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --import tsx src/services/runtime-settings.test.ts`

Expected: FAIL，原因是新的字段与持久化接口尚不存在。

- [ ] **Step 3: 实现持久化和原子更新**

配置字段固定为：

```ts
interface RuntimeSettings {
  ragEnabled: boolean
  ragMode: 'bge' | 'tfidf'
  ragWeight: number
  ragTopK: number
  kgEnabled: boolean
  kgWeight: number
  spatialEnabled: boolean
  spatialWeight: number
  llmModel: string
  maxTokens: number
  temperature: number
  updatedAt: string | null
  updatedBy: string | null
}
```

三个权重范围为 `0..1`，Top-K 为 `1..20`，Token 为 `256..8192`，Temperature 为 `0..1`。更新流程先合并、完整校验、SQLite 事务写入，成功后才替换内存快照。

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --import tsx src/services/runtime-settings.test.ts`

Expected: PASS，输出所有配置校验与持久化断言通过。

### Task 2: 真实能力状态与管理员接口

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Modify: `backend/src/services/kg.ts`
- Create: `backend/src/services/retrieval-status.ts`
- Create: `backend/src/services/retrieval-status.test.ts`

**Interfaces:**
- Produces: `getRetrievalStatus(): Promise<RetrievalConfigResponse>`。
- Consumes: Flask `/health` 详细状态、Neo4j 轻量查询、空间数据源状态、BERT-NER 与 OWL 文件元数据。

- [ ] **Step 1: 写失败测试**

注入 Flask 健康响应与文件探测器，断言 BGE/TF-IDF 分别显示真实可用性、离线产物不会显示为在线路径、空间 Mock 明确标记 `demo: true`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --import tsx src/services/retrieval-status.test.ts`

Expected: FAIL，原因是状态聚合器尚不存在。

- [ ] **Step 3: 实现状态聚合与 GET/PUT 接口**

`GET /api/admin/retrieval-config` 返回：

```ts
{
  settings: RuntimeSettings,
  capabilities: CapabilityStatus[],
  offlineArtifacts: ArtifactStatus[],
  loaded: true
}
```

`PUT` 只接受运行时配置字段，使用 JWT 用户名填写 `updatedBy`，成功后返回同一结构。探测失败只影响相应能力，不让整个配置页返回 500。

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --import tsx src/services/retrieval-status.test.ts`

Expected: PASS。

### Task 3: Flask 显式模式选择

**Files:**
- Modify: `ml-service/server.py`
- Create: `ml-service/test_server_retrieval_mode.py`

**Interfaces:**
- `/search` consumes: `{ question, top_k, retrieval_mode: 'bge' | 'tfidf' }`。
- `/health` produces: `retrieval.bge`、`retrieval.tfidf`、`retrieval.available_modes` 与各自不可用原因。

- [ ] **Step 1: 写失败测试**

使用 Flask test client 验证非法模式返回 400、显式 TF-IDF 调用 TF-IDF、BGE 未加载时返回 503 且不调用 TF-IDF。

- [ ] **Step 2: 运行测试并确认失败**

Run: `python test_server_retrieval_mode.py`

Expected: FAIL，现有接口忽略 `retrieval_mode` 并会静默降级。

- [ ] **Step 3: 实现显式模式与详细健康信息**

保留环境变量作为启动默认模式，但每个搜索请求以合法的显式模式为准。选择的索引不可用时返回包含 `code`、`mode`、`reason` 的 503 响应。

- [ ] **Step 4: 运行测试并确认通过**

Run: `python test_server_retrieval_mode.py`

Expected: PASS。

### Task 4: 问答执行链路应用配置

**Files:**
- Modify: `backend/src/services/tfidf.ts`
- Modify: `backend/src/routes/qa.ts`
- Modify: `backend/src/db/sqlite.ts`
- Create: `backend/src/services/retrieval-policy.ts`
- Create: `backend/src/services/retrieval-policy.test.ts`

**Interfaces:**
- `search(query, topK, mode)` 将模式转发给 Flask，并返回带 `mode` 的成功结果或明确失败信息。
- `resolveRetrievalPolicy(requestedMode, settings)` 返回 `useRag/useKg/useSpatial/ragMode/topK/weights`。

- [ ] **Step 1: 写失败测试**

覆盖管理员关闭路径后请求无法绕过、用户 `rag/kg/hybrid` 只能缩小范围、权重为 0 仍执行但记录权重、`pathUsed` 使用 `bge|tfidf|kg|spatial` 实际成功路径。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --import tsx src/services/retrieval-policy.test.ts`

Expected: FAIL，策略函数与新路径名尚不存在。

- [ ] **Step 3: 实现策略并接入流式/非流式问答**

空间检索也受 `spatialEnabled` 控制。全部路径均关闭或不可用时返回 503：

```json
{ "error": "当前没有可用的检索路径，请联系管理员检查检索配置" }
```

RAG 分数按 `ragWeight` 生成排序副本；日志新增三条权重与 RAG 模式字段，旧数据库自动补列。低相关度只依据实际执行成功的路径判断。

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --import tsx src/services/retrieval-policy.test.ts`

Expected: PASS。

### Task 5: 管理员检索配置界面

**Files:**
- Create: `frontend/src/api/retrieval-config.ts`
- Create: `frontend/src/utils/retrieval-config.ts`
- Create: `frontend/src/utils/retrieval-config.test.ts`
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/views/AdminView.vue`

**Interfaces:**
- `getRetrievalConfig()` 与 `saveRetrievalConfig(settings)` 直接调用真实管理员接口。
- `toRuntimeSettingsPayload(form)` 只挑选允许保存的字段。

- [ ] **Step 1: 写失败测试**

断言保存载荷不包含能力状态、离线产物和只读字段；非法数值返回字段级错误；保存失败不会修改原始表单对象。

- [ ] **Step 2: 运行测试并确认失败**

Run: `..\backend\node_modules\.bin\tsx.cmd src/utils/retrieval-config.test.ts`

Expected: FAIL，工具与共享类型尚不存在。

- [ ] **Step 3: 实现界面**

配置页按“服务与索引状态、检索策略、生成参数、离线增强能力”四段展示。布尔值使用开关，RAG 模式使用分段选择，权重和数值使用输入控件；不可用能力显示原因。保存失败只提示错误，不调用全页刷新；成功后显示更新时间和当前进程已加载状态。

- [ ] **Step 4: 运行前端测试和类型检查**

Run: `..\backend\node_modules\.bin\tsx.cmd src/utils/retrieval-config.test.ts`

Run: `npm.cmd run type-check`

Expected: 两条命令均 PASS。

### Task 6: 全链路验证

**Files:**
- Verify only; no new files required.

- [ ] **Step 1: 运行自动化验证**

Run: `npm.cmd run build` in `backend/`

Run: `python test_server_retrieval_mode.py` in `ml-service/`

Run: `npm.cmd run build` in `frontend/`

Run: `git diff --check` in repository root.

- [ ] **Step 2: 运行接口验收**

管理员登录后读取配置，关闭空间检索并保存，发起包含空间意图的问题，确认问答日志 `pathUsed` 不含 `spatial`；重启 Node 后再次读取配置，确认开关仍保持。随后恢复原配置，避免影响后续演示。

- [ ] **Step 3: 整理人工验证步骤**

给出后台点击路径、两组建议参数、问答测试问题、日志观察点，并明确 Mock 与评分均为演示用途。
