# 问答驱动地图功能编排 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户通过智能问答自动执行空间查询、过滤、评分、热力、时间轴、区域对比、网格预测和靶区圈定，并在问答页与完整地图页之间保留同一分析状态。

**Architecture:** 后端用确定性规则把现有空间解释结果转换成版本化 `MapPlan`，通过普通 JSON 和 SSE 返回。前端用 Pinia `spatial-task` Store 校验并归约动作，`QaView` 展示简化结果，`MapView` 执行完整动作。网格预测由独立后端服务使用 Turf 生成网格、计算解释性评分并合并高分靶区。

**Tech Stack:** TypeScript、Express、Vue 3、Pinia、AMap JSAPI、Turf、Node `assert`

## Global Constraints

- 系统仍以问答为主入口，不为网格预测新增独立顶级页面。
- 地图计划只能执行白名单动作，不执行 LLM 输出的函数名、代码、URL 或任意参数。
- 普通空间问题留在问答页；只有明确地图意图或复杂动作才进入完整地图。
- 导出只生成建议状态，不自动触发文件下载。
- Mock 坐标、规则评分、网格和靶区必须标注为演示用途，不作为实际勘查结论。
- 保留当前所有未提交空间功能和检索配置改动，不回退、不覆盖用户文件。
- 当前工作区为 `master` 且存在未提交改动；本轮只实现和验证，不自动 commit。

---

### Task 1: 共享地图动作类型与后端计划生成器

**Files:**
- Modify: `backend/src/types/index.ts`
- Create: `backend/src/services/map-plan.ts`
- Create: `backend/src/services/map-plan.test.ts`
- Modify: `frontend/src/types/index.ts`

**Interfaces:**
- Consumes: `buildMapPlan(question: string, analysis?: SpatialAnalysis): MapPlan | undefined`
- Produces: `MapPlan`、`MapAction`、`MapActionType`，前后端字段完全一致。

- [ ] **Step 1: 写失败测试**

```ts
const plan = buildMapPlan('对比攀西和东天山钒钛磁铁矿有利度', analysis)
assert.deepEqual(plan?.actions.map((item) => item.type), [
  'query', 'filter-region', 'set-result-mode', 'compare-regions', 'fit-bounds',
])
assert.equal(buildMapPlan('你好，介绍一下你自己'), undefined)
assert.deepEqual(
  buildMapPlan('用10公里网格预测攀西靶区', analysis)?.actions.at(-2),
  { type: 'grid-prediction', gridSizeKm: 10, minimumScore: 85 },
)
```

- [ ] **Step 2: 运行测试确认缺少模块而失败**

Run: `node --import tsx src/services/map-plan.test.ts` in `backend/`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现动作协议与确定性规划规则**

动作联合类型固定为设计文档中的 12 种动作。`buildMapPlan` 按以下顺序组装：`query -> filters -> result mode/buffer -> heatmap/timeline/comparison/grid -> fit-bounds -> export suggestion`。半径裁剪到 `0.1..1000`，网格只接受 `5|10|20`，未指定网格默认 10。

```ts
export function buildMapPlan(question: string, analysis?: SpatialAnalysis): MapPlan | undefined {
  const interpretation = analysis?.interpretation ?? parseSpatialQuestion(question)
  if (!interpretation.spatialIntent) return undefined
  const actions: MapAction[] = [{ type: 'query', question }]
  // 从 interpretation 和 analysis.regions 依次追加白名单动作
  return {
    id: createHash('sha1').update(question + JSON.stringify(actions)).digest('hex').slice(0, 12),
    version: 1,
    title: `${interpretation.mineralKinds[0] || '地质要素'}空间分析`,
    autoExecute: true,
    openFullMap: explicitMapIntent || complexAction,
    actions,
    warnings: [],
  }
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --import tsx src/services/map-plan.test.ts`

Expected: PASS，输出 query、buffer、heatmap、timeline、comparison、grid 和 export 规则断言。

### Task 2: 问答 JSON/SSE 返回地图计划

**Files:**
- Modify: `backend/src/routes/qa.ts`
- Modify: `backend/src/types/index.ts`
- Modify: `frontend/src/api/qa.ts`
- Modify: `frontend/src/types/index.ts`

**Interfaces:**
- `QaAskResponse.mapPlan?: MapPlan`
- `QaStreamCallbacks.onMeta(meta.mapPlan?)`
- `QaStreamCallbacks.onDone(..., mapPlan?)`

- [ ] **Step 1: 扩充前端 SSE 解析测试**

在 `frontend/src/api/qa.test.ts` 构造 `meta` 与 `done` 事件，断言 `normalizeMapPlan()` 拒绝未知版本和未知动作，并保留合法计划。

```ts
assert.equal(normalizeMapPlan({ version: 2, actions: [] }), undefined)
assert.equal(normalizeMapPlan(validPlan)?.actions[0]?.type, 'query')
```

- [ ] **Step 2: 运行测试确认失败**

Run: `..\backend\node_modules\.bin\tsx.cmd src/api/qa.test.ts` in `frontend/`

Expected: FAIL，因为 `normalizeMapPlan` 尚未导出。

- [ ] **Step 3: 接入问答响应**

在空间分析完成后调用：

```ts
const mapPlan = buildMapPlan(trimmedQuestion, spatialAnalysis)
```

将 `mapPlan` 同时放入 SSE `meta`、SSE `done` 和普通 JSON。低相关问候不返回计划。前端 `normalizeMapPlan` 白名单验证 `version===1`、动作数组、距离和网格字段，再传给回调。

- [ ] **Step 4: 运行前端解析测试和后端构建**

Run: `..\backend\node_modules\.bin\tsx.cmd src/api/qa.test.ts`

Run: `npm.cmd run build` in `backend/`

Expected: PASS。

### Task 3: 空间任务状态机与会话恢复

**Files:**
- Create: `frontend/src/utils/map-plan.ts`
- Create: `frontend/src/utils/map-plan.test.ts`
- Create: `frontend/src/stores/spatial-task.ts`
- Modify: `frontend/src/stores/qa.ts`
- Modify: `frontend/src/types/index.ts`

**Interfaces:**
- `reduceMapPlan(plan, previous?): SpatialTaskSnapshot`
- `useSpatialTaskStore().accept(plan, data, analysis)`
- `useSpatialTaskStore().clear()`
- `useSpatialTaskStore().markAction(type, status, message?)`

- [ ] **Step 1: 写状态机失败测试**

```ts
const snapshot = reduceMapPlan(plan)
assert.equal(snapshot.resultMode, 'score')
assert.deepEqual(snapshot.selectedRegions, ['攀西钒钛成矿带', '东天山成矿带'])
assert.equal(snapshot.grid?.gridSizeKm, 10)
assert.equal(snapshot.exportSuggestion, undefined)
assert.equal(reduceMapPlan(plan, snapshot).planId, snapshot.planId)
```

同时验证未知动作标记为失败、`suggest-export` 只记录建议、不下载文件、计划 ID 相同不会重复执行。

- [ ] **Step 2: 运行测试确认失败**

Run: `..\backend\node_modules\.bin\tsx.cmd src/utils/map-plan.test.ts`

Expected: FAIL with missing module。

- [ ] **Step 3: 实现纯归约器与 Pinia Store**

Store 快照结构：

```ts
interface SpatialTaskSnapshot {
  planId: string
  plan?: MapPlan
  data?: SpatialData
  analysis?: SpatialAnalysis
  selectedRegions: string[]
  selectedEras: string[]
  selectedEntityTypes: GeoEntityType[]
  resultMode: 'query' | 'score'
  heatmapEnabled: boolean
  timeline: { mode: 'all' | 'single' | 'play'; era?: string }
  buffer?: { radiusKm: number; anchorName?: string; targetType?: GeoEntityType }
  grid?: { gridSizeKm: 5 | 10 | 20; minimumScore: number }
  exportSuggestion?: 'geojson' | 'csv'
  actionResults: MapActionResult[]
}
```

只把当前快照写入 `sessionStorage['geo-spatial-task']`。`qa.ts` Store 在收到新的 `meta/done mapPlan` 时调用 `accept`；历史消息加载或切换对话不调用。

- [ ] **Step 4: 运行状态机测试与前端类型检查**

Run: `..\backend\node_modules\.bin\tsx.cmd src/utils/map-plan.test.ts`

Run: `npm.cmd run type-check`

Expected: PASS。

### Task 4: 问答页动作反馈与完整地图跳转

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/components/ChatMessage.vue`
- Modify: `frontend/src/views/QaView.vue`
- Modify: `frontend/src/stores/qa.ts`

**Interfaces:**
- `Message.mapPlan?: MapPlan`
- `ChatMessage` emits `open-full-map` and `clear-map-plan`
- `QaView` renders current Store data and filters supported by the embedded map。

- [ ] **Step 1: 添加动作显示纯函数测试**

在 `frontend/src/utils/map-plan.test.ts` 增加：

```ts
assert.deepEqual(mapPlanLabels(plan), ['空间查询', '区域筛选', '有利度排序', '区域对比', '地图定位'])
assert.equal(requiresFullMap(plan), true)
```

- [ ] **Step 2: 运行测试确认新导出缺失**

Run: `..\backend\node_modules\.bin\tsx.cmd src/utils/map-plan.test.ts`

Expected: FAIL with missing export。

- [ ] **Step 3: 实现问答交互**

消息空间证据区增加状态行和两个命令按钮。普通计划继续展示 QaView 内嵌地图；复杂计划不自动导航，除非 `openFullMap=true`。跳转使用当前角色对应路由：

```ts
const mapRouteName = localStorage.getItem('role') === 'admin' ? 'AdminMap' : 'UserMap'
await router.push({ name: mapRouteName, query: { task: spatialTask.planId } })
```

问答页根据 Store 的区域、年代和实体类型过滤 `activeSpatial`，评分模式用现有 marker 分数着色。清除只清当前空间任务，不删除问答消息。

- [ ] **Step 4: 运行类型检查与生产构建**

Run: `npm.cmd run type-check`

Run: `npm.cmd run build`

Expected: PASS。

### Task 5: 完整地图消费现有动作

**Files:**
- Modify: `frontend/src/views/MapView.vue`
- Modify: `frontend/src/stores/spatial-task.ts`
- Modify: `frontend/src/utils/map-plan.ts`

**Interfaces:**
- `applySpatialTaskToMap(snapshot)` 把共享状态同步到 MapView 本地渲染状态。
- 现有 `setResultMode`、`selectEra`、`selectRegion`、`toggleHeatmap`、`toggleTimelinePlayback` 由执行器按动作调用。

- [ ] **Step 1: 扩充状态转换失败测试**

```ts
const view = toMapViewState(snapshot)
assert.equal(view.selectedRegion, '攀西钒钛成矿带')
assert.equal(view.selectedEra, '晚二叠世')
assert.equal(view.resultMode, 'score')
assert.equal(view.heatmapVisible, true)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `..\backend\node_modules\.bin\tsx.cmd src/utils/map-plan.test.ts`

Expected: FAIL with missing `toMapViewState`。

- [ ] **Step 3: 接入 MapView**

地图初始化完成后，若 URL 的 `task` 等于 Store `planId`，加载 Store 的 `data/analysis`，同步过滤条件并依序执行完整动作。缓冲动作优先使用后端已经计算的 `distanceKm/nearestStructureKm` 过滤；需要真实线缓冲渲染时留给网格任务后的 Turf 覆盖物实现。

动作执行结束逐项调用 `markAction`，失败动作显示在结果面板但不阻塞其他动作。`suggest-export` 只高亮现有导出按钮。

- [ ] **Step 4: 运行前端测试、类型检查和构建**

Run: `..\backend\node_modules\.bin\tsx.cmd src/utils/map-plan.test.ts`

Run: `npm.cmd run type-check`

Run: `npm.cmd run build`

Expected: PASS。

### Task 6: 网格有利度与靶区圈定 API

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Modify: `backend/src/types/index.ts`
- Create: `backend/src/services/prospectivity-grid.ts`
- Create: `backend/src/services/prospectivity-grid.test.ts`
- Modify: `backend/src/routes/spatial.ts`

**Interfaces:**
- `buildProspectivityGrid(data, options): ProspectivityGridResult`
- `POST /api/spatial/grid` consumes `{ question, gridSizeKm, minimumScore }`
- Produces GeoJSON-like `cells`、`targets`、`summary`、`warnings`。

- [ ] **Step 1: 安装 Turf**

Run: `npm.cmd install @turf/turf` in `backend/`

Expected: `package.json` and lockfile contain `@turf/turf`。

- [ ] **Step 2: 写网格失败测试**

使用固定攀西数据，断言：

```ts
assert.equal(result.gridSizeKm, 10)
assert.ok(result.cells.length > 0)
assert.ok(result.cells.every((cell) => cell.score >= 0 && cell.score <= 100))
assert.ok(result.cells.every((cell) => cell.factors.reduce((sum, factor) => sum + factor.maxScore, 0) === 100))
assert.ok(result.targets.every((target) => target.minimumScore === 85))
assert.equal(result.demo, true)
```

- [ ] **Step 3: 运行测试确认失败**

Run: `node --import tsx src/services/prospectivity-grid.test.ts`

Expected: FAIL with missing module。

- [ ] **Step 4: 实现 Turf 网格与连通靶区**

使用 `squareGrid` 生成方格，`booleanPointInPolygon` 统计矿点，`pointToLineDistance` 计算构造邻近度。四项得分固定为 40/25/20/15。只保留数据包围范围及一格外扩内的网格，硬上限 5000 格。

高分格按行列四邻域做连通分组，给每组写入 `targetId`，再用 Turf `dissolve` 合并为靶区。每个靶区计算面积、平均/最高分、矿点数、主要矿种和年代。

- [ ] **Step 5: 接入路由并验证**

非法网格、阈值或超限返回 400；无空间数据返回 200 空结果与 warning。运行：

Run: `node --import tsx src/services/prospectivity-grid.test.ts`

Run: `npm.cmd run build`

Expected: PASS。

### Task 7: 网格动作前端执行与靶区展示

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/api/spatial.ts`
- Modify: `frontend/src/stores/spatial-task.ts`
- Modify: `frontend/src/views/MapView.vue`
- Create: `frontend/src/utils/prospectivity-grid.ts`
- Create: `frontend/src/utils/prospectivity-grid.test.ts`

**Interfaces:**
- `queryProspectivityGrid(request): Promise<ProspectivityGridResult>`
- `gridCellColor(score): string`
- `gridTargetSummary(target): string`

- [ ] **Step 1: 写失败测试**

```ts
assert.equal(gridCellColor(90), '#B83A1F')
assert.equal(gridCellColor(80), '#B8860B')
assert.equal(gridCellColor(60), '#2E7D5B')
assert.match(gridTargetSummary(target), /演示靶区 A/)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `..\backend\node_modules\.bin\tsx.cmd src/utils/prospectivity-grid.test.ts`

Expected: FAIL with missing module。

- [ ] **Step 3: 实现地图覆盖物和详情**

执行 `grid-prediction` 时调用 `/spatial/grid`，用 `AMap.Polygon` 绘制网格和靶区边界。网格填充色按高/中/低分级，点击后显示四项因素。右侧结果区增加靶区排名、面积、均分、最高分、主要矿种和年代；页面始终显示演示声明。

问答页只显示“网格任务已准备，进入完整地图查看”，不渲染大量多边形。

- [ ] **Step 4: 运行测试、类型检查与构建**

Run: `..\backend\node_modules\.bin\tsx.cmd src/utils/prospectivity-grid.test.ts`

Run: `npm.cmd run type-check`

Run: `npm.cmd run build`

Expected: PASS。

### Task 8: 全链路验收

**Files:**
- Verify only.

- [ ] **Step 1: 运行所有新增和现有回归测试**

Run backend map-plan、grid、retrieval-policy、spatial-query tests；运行 Flask retrieval test；运行 frontend map-plan、grid、retrieval-config、spatial-export tests。

- [ ] **Step 2: 运行构建与差异检查**

Run: `npm.cmd run build` in `backend/`

Run: `npm.cmd run build` in `frontend/`

Run: `git diff --check`

- [ ] **Step 3: HTTP 验收**

验证“对比攀西和东天山的钒钛磁铁矿有利度”返回 comparison 计划；验证“用10公里网格预测攀西钒钛磁铁矿靶区”返回 grid 计划并能请求网格 API；验证非空间问候不返回计划。

- [ ] **Step 4: 浏览器人工验收**

在问答页验证自动空间状态和完整地图入口；进入地图页验证查询、评分、过滤、热力、时间轴、对比、网格和靶区；检查桌面与窄屏布局没有重叠，地图失败时仍有列表兜底。
