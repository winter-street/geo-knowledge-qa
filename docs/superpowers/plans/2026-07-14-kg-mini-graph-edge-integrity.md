# KG Mini Graph Edge Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent `KgMiniGraph` from sending edges with missing endpoints to G6 while preserving the existing 40-node limit and presenting a readable render error when G6 fails.

**Architecture:** Add a small pure sanitizer at the API-to-view boundary so node truncation and edge filtering happen atomically. Keep a second endpoint check against the actual G6 node list as defense in depth, and contain constructor/render Promise failures inside the component.

**Tech Stack:** Vue 3, TypeScript, AntV G6 5, Vitest 4

## Global Constraints

- Keep the maximum rendered subgraph size at 40 nodes.
- Preserve API order when deduplicating and truncating nodes and edges.
- Do not mutate the input arrays or their members.
- Do not change backend Neo4j queries, graph layout, graph styles, or graph interactions.
- Show `知识图谱渲染失败` when G6 construction or rendering rejects.

---

### Task 1: Add the pure subgraph sanitizer

**Files:**
- Create: `frontend/src/utils/kg-graph.ts`
- Test: `frontend/src/utils/kg-graph.test.ts`

**Interfaces:**
- Consumes: `GraphNode`, `GraphEdge`, and `Subgraph` from `frontend/src/api/kg.ts`.
- Produces: `sanitizeSubgraph(nodes: GraphNode[], edges: GraphEdge[], maxNodes?: number): Subgraph`.

- [ ] **Step 1: Write the failing sanitizer tests**

Create `frontend/src/utils/kg-graph.test.ts` with real input arrays covering truncation, valid edges, duplicates, immutability, and a zero limit:

```ts
import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode } from '@/api/kg'
import { sanitizeSubgraph } from './kg-graph'

const node = (id: string): GraphNode => ({ id, label: `节点${id}`, type: 'Mineral' })
const edge = (source: string, target: string, label = '关联', inferred = false): GraphEdge => ({
  source,
  target,
  label,
  inferred,
})

describe('sanitizeSubgraph', () => {
  it('removes edges to the 41st node after applying the 40-node limit', () => {
    const nodes = Array.from({ length: 41 }, (_, index) => node(String(index + 1)))
    const result = sanitizeSubgraph(nodes, [edge('1', '40'), edge('1', '41')])

    expect(result.nodes).toHaveLength(40)
    expect(result.nodes.at(-1)?.id).toBe('40')
    expect(result.edges).toEqual([edge('1', '40')])
  })

  it('keeps edges whose endpoints are both retained', () => {
    expect(sanitizeSubgraph([node('1'), node('2')], [edge('1', '2')])).toEqual({
      nodes: [node('1'), node('2')],
      edges: [edge('1', '2')],
    })
  })

  it('deduplicates nodes and identical edges while preserving order', () => {
    const inferred = edge('2', '1', '推理关联', true)
    const result = sanitizeSubgraph(
      [node('1'), node('1'), node('2')],
      [edge('1', '2'), edge('1', '2'), inferred, inferred],
    )

    expect(result).toEqual({
      nodes: [node('1'), node('2')],
      edges: [edge('1', '2'), inferred],
    })
  })

  it('does not mutate input arrays', () => {
    const nodes = [node('1'), node('1'), node('2')]
    const edges = [edge('1', '2'), edge('1', '3')]
    const originalNodes = structuredClone(nodes)
    const originalEdges = structuredClone(edges)

    sanitizeSubgraph(nodes, edges, 2)

    expect(nodes).toEqual(originalNodes)
    expect(edges).toEqual(originalEdges)
  })

  it('returns an empty subgraph when maxNodes is zero', () => {
    expect(sanitizeSubgraph([node('1')], [edge('1', '1')], 0)).toEqual({ nodes: [], edges: [] })
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
cd frontend
npx.cmd vitest run src/utils/kg-graph.test.ts
```

Expected: FAIL because `./kg-graph` does not exist or does not export `sanitizeSubgraph`.

- [ ] **Step 3: Implement the minimal sanitizer**

Create `frontend/src/utils/kg-graph.ts`:

```ts
import type { GraphEdge, GraphNode, Subgraph } from '@/api/kg'

export function sanitizeSubgraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  maxNodes = 40,
): Subgraph {
  const uniqueNodes: GraphNode[] = []
  const seenNodeIds = new Set<string>()

  for (const node of nodes) {
    if (seenNodeIds.has(node.id)) continue
    seenNodeIds.add(node.id)
    uniqueNodes.push(node)
  }

  const retainedNodes = uniqueNodes.slice(0, Math.max(0, maxNodes))
  const retainedNodeIds = new Set(retainedNodes.map((node) => node.id))
  const seenEdges = new Set<string>()
  const retainedEdges = edges.filter((edge) => {
    if (!retainedNodeIds.has(edge.source) || !retainedNodeIds.has(edge.target)) return false
    const key = `${edge.source}|${edge.target}|${edge.label}|${Boolean(edge.inferred)}`
    if (seenEdges.has(key)) return false
    seenEdges.add(key)
    return true
  })

  return { nodes: retainedNodes, edges: retainedEdges }
}
```

- [ ] **Step 4: Run focused and utility tests and verify GREEN**

Run:

```powershell
npx.cmd vitest run src/utils/kg-graph.test.ts
npm.cmd test
```

Expected: all sanitizer tests and existing utility tests PASS.

- [ ] **Step 5: Commit the sanitizer**

```powershell
git add frontend/src/utils/kg-graph.ts frontend/src/utils/kg-graph.test.ts
git commit -m "修复：清理知识图谱悬空边"
```

---

### Task 2: Integrate safe data and contain G6 render failures

**Files:**
- Modify: `frontend/src/components/KgMiniGraph.vue`
- Test: `frontend/src/utils/kg-graph.test.ts`

**Interfaces:**
- Consumes: `sanitizeSubgraph()` from Task 1 and the existing `getSubgraph()` response.
- Produces: G6 data whose every edge endpoint exists in `g6Nodes`, plus component error state `知识图谱渲染失败` on constructor or Promise failure.

- [ ] **Step 1: Re-run the regression test before component integration**

Run:

```powershell
cd frontend
npx.cmd vitest run src/utils/kg-graph.test.ts
```

Expected: PASS, proving the data-boundary behavior is available for integration.

- [ ] **Step 2: Sanitize API data atomically in `loadGraph()`**

Import the helper:

```ts
import { sanitizeSubgraph } from '@/utils/kg-graph'
```

Replace direct assignment and standalone slicing with:

```ts
const safe = sanitizeSubgraph(data.nodes || [], data.edges || [], 40)
nodes.value = safe.nodes
edges.value = safe.edges
```

- [ ] **Step 3: Restrict adjacency and G6 edges to real nodes**

Build adjacency only for known endpoints:

```ts
for (const e of edges.value) {
  if (!adj.has(e.source) || !adj.has(e.target)) continue
  adj.get(e.source)!.push(e.target)
  adj.get(e.target)!.push(e.source)
}
```

After `g6Nodes` is built, create the rendered ID set and filter with it:

```ts
const renderedNodeIds = new Set(g6Nodes.map((node) => node.id))

const g6Edges = edges.value
  .filter((edge) => renderedNodeIds.has(edge.source) && renderedNodeIds.has(edge.target))
```

- [ ] **Step 4: Catch constructor and asynchronous render failures**

Wrap Graph creation and rendering in one `try/catch`, await the Promise, and destroy partial state on failure:

```ts
try {
  graph = new Graph({
    container: el,
    width,
    height,
    autoFit: 'view',
    data: { nodes: g6Nodes, edges: g6Edges },
    layout: { type: 'd3-force', iterations: 1, alpha: 0, alphaDecay: 1 },
    animation: false,
    behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
  })
  await graph.render()
} catch (err) {
  graph?.destroy()
  graph = null
  error.value = '知识图谱渲染失败'
  console.error('知识图谱渲染失败:', err)
}
```

- [ ] **Step 5: Run complete frontend verification**

Run:

```powershell
cd frontend
npx.cmd vitest run src/utils/kg-graph.test.ts
npm.cmd test
npm.cmd run type-check
npm.cmd run build
```

Expected: all tests PASS, Vue TypeScript reports no errors, and Vite production build exits with code 0.

- [ ] **Step 6: Inspect the final diff and commit the integration**

Run:

```powershell
git diff --check
git diff -- frontend/src/components/KgMiniGraph.vue frontend/src/utils/kg-graph.ts frontend/src/utils/kg-graph.test.ts
git add frontend/src/components/KgMiniGraph.vue
git commit -m "修复：避免知识图谱渲染悬空边"
```

- [ ] **Step 7: Manual browser verification**

Ask this question in the running application:

```text
请分析攀西钒钛磁铁矿的主要控矿构造和赋矿围岩；以攀枝花钒钛磁铁矿为中心进行10公里缓冲区分析，筛选范围内的矿床和岩石，按找矿有利度排序，并显示热力图和5公里预测网格；再对比攀西钒钛成矿带与东天山成矿带的矿点数量和成矿年代演化，最后提示导出GeoJSON。
```

Expected: both inline expansion and fullscreen graph render without `Node not found for id` in the browser console. Existing graph styling, layout, and the 40-node maximum remain unchanged.
