# KG Mini Graph Edge Integrity Design

> 日期：2026-07-14
> 状态：设计已确认，待书面审阅

## 问题

`KgMiniGraph.vue` 从 `/api/kg/subgraph` 接收节点和边。节点超过 40 个时，组件执行 `nodes.slice(0, 40)`，但没有同步过滤边。随后 BFS 会通过仍然存在的边把已删除端点重新写入 `hop`，`g6Edges` 又只检查 `hop.has()`，最终把指向缺失节点的边交给 G6，触发：

```text
Error: Node not found for id: 96
```

同一问题会在首次展开、流式回答更新和全屏打开时重复出现，并以未处理 Promise 的形式进入控制台。

## 目标

- 保留现有最多 40 个节点的性能限制。
- 裁剪节点时同步删除端点不存在的边。
- G6 渲染前再次验证边的两个端点都在实际渲染节点集合中。
- 捕获 G6 构造和渲染异常，在组件中显示可读错误，不产生未处理 Promise。
- 内联图和全屏图使用同一份安全数据，不产生不同结果。

## 非目标

- 不修改后端 Neo4j 子图查询。
- 不提高或取消 40 节点上限。
- 不调整图谱布局、颜色、节点大小和交互样式。
- 不处理高德地图的 `willReadFrequently` 性能提示；该提示与 G6 缺失节点错误无关。

## 设计

新增纯函数模块 `frontend/src/utils/kg-graph.ts`：

```ts
export function sanitizeSubgraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  maxNodes = 40,
): Subgraph
```

处理顺序：

1. 按接口原顺序去重节点 ID。
2. 取前 `maxNodes` 个节点。
3. 建立保留节点 ID 集合。
4. 只保留 `source` 和 `target` 都存在于集合中的边。
5. 对完全相同的 `source|target|label|inferred` 边去重。

`loadGraph()` 收到接口响应后立即调用 `sanitizeSubgraph()`，一次性更新 `nodes` 和 `edges`，不再单独截断节点。

`buildG6Data()` 完成 `g6Nodes` 后，再用 `new Set(g6Nodes.map(node => node.id))` 过滤 `g6Edges`。这层检查以实际送入 G6 的节点为准，防止以后增加跳数过滤或其他节点筛选时再次产生悬空边。

`render()` 用 `try/catch` 包裹 G6 构造与 `graph.render()`。失败时销毁半初始化实例，写入 `error='知识图谱渲染失败'` 并记录控制台错误。所有调用方继续调用同一个 `render()`，不各自处理异常。

## 测试

新增 `frontend/src/utils/kg-graph.test.ts`，使用 Vitest 验证：

1. 41 个节点被限制为 40 个时，指向第 41 个节点的边被删除。
2. 两端都保留的边不受影响。
3. 重复节点和重复边被稳定去重。
4. 输入数组不被修改。
5. `maxNodes=0` 返回空节点和空边。

最后运行：

```text
npx vitest run src/utils/kg-graph.test.ts
npm run type-check
npm run build
```

人工验证使用此前的综合问答问题，确认知识图谱内联展开和全屏打开均不再出现 `Node not found`。

## 实施范围

- 新增 `frontend/src/utils/kg-graph.ts`
- 新增 `frontend/src/utils/kg-graph.test.ts`
- 修改 `frontend/src/components/KgMiniGraph.vue`

不提交或改动当前工作区内无关的 DOCX、PPT、assets 和教师文档脚本。
