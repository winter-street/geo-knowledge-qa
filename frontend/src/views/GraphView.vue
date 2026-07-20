<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { Graph } from '@antv/g6'
import { getSubgraph, type GraphNode, type GraphEdge } from '@/api/kg'
import { CATEGORY_META, DEFAULT_CATEGORY_COLOR } from '@/utils/spatial'
import { owlTypeMeta } from '@/utils/owl'

const searchText = ref('磁铁矿')
const hopCount = ref(2)
const nodes = ref<GraphNode[]>([])
const edges = ref<GraphEdge[]>([])
const loading = ref(false)
const selectedNode = ref<GraphNode | null>(null)
const selectedEdges = computed(() => {
  const selected = selectedNode.value
  if (!selected) return []
  return edges.value
    .filter((edge) => edge.source === selected.id || edge.target === selected.id)
    .slice(0, 10)
})

let graph: Graph | null = null

// 地质类型配色（统一引用 spatial.ts CATEGORY_META，避免两处维护）
const typeColors: Record<string, string> = {
  Mineral: CATEGORY_META['Mineral']!.color,
  Rock: CATEGORY_META['Rock']!.color,
  Structure: CATEGORY_META['Structure']!.color,
  TimePeriod: CATEGORY_META['TimePeriod']!.color,
  DepositType: CATEGORY_META['DepositType']!.color,
}
const defaultColor = DEFAULT_CATEGORY_COLOR

function typeLabel(t: string): string {
  const map: Record<string, string> = {
    Mineral: '矿产', Rock: '岩石', Structure: '构造',
    TimePeriod: '年代', DepositType: '成因类型',
  }
  return map[t] || t
}

function colorForType(type: string): string {
  return typeColors[type] || defaultColor
}

/** BFS 计算每个节点到种子节点的最短跳数 */
function computeHopDistances(
  seedIds: Set<string>,
  nodeList: GraphNode[],
  edgeList: GraphEdge[]
): Map<string, number> {
  const dist = new Map<string, number>()
  const adj = new Map<string, string[]>()

  for (const n of nodeList) adj.set(n.id, [])
  for (const e of edgeList) {
    adj.get(e.source)?.push(e.target)
    adj.get(e.target)?.push(e.source)
  }

  // BFS queue
  const queue: string[] = []
  for (const sid of seedIds) {
    dist.set(sid, 0)
    queue.push(sid)
  }

  let head = 0
  while (head < queue.length) {
    const cur = queue[head++]!
    const d = dist.get(cur)! + 1
    for (const nb of adj.get(cur) || []) {
      if (!dist.has(nb)) {
        dist.set(nb, d)
        queue.push(nb)
      }
    }
  }

  // 不可达的放最外层
  for (const n of nodeList) {
    if (!dist.has(n.id)) dist.set(n.id, 99)
  }

  return dist
}

// 侧边栏统计
function entityTypeStats() {
  const map = new Map<string, { color: string; count: number }>()
  for (const n of nodes.value) {
    const c = colorForType(n.type)
    const label = typeLabel(n.type)
    const entry = map.get(label)
    if (entry) { entry.count++ }
    else { map.set(label, { color: c, count: 1 }) }
  }
  return Array.from(map.entries()).map(([label, v]) => ({ label, ...v }))
}

function relationTypeStats() {
  const map = new Map<string, number>()
  for (const e of edges.value) {
    map.set(e.label, (map.get(e.label) || 0) + 1)
  }
  return Array.from(map.entries()).map(([label, count]) => ({ label, count }))
}

function owlTypeStats() {
  const counts = new Map<string, number>()
  for (const node of nodes.value) {
    for (const type of node.owlTypes || []) {
      counts.set(type, (counts.get(type) || 0) + 1)
    }
  }
  return [...counts.entries()].map(([type, count]) => ({
    type,
    count,
    ...owlTypeMeta(type),
  }))
}

async function loadGraph() {
  loading.value = true
  selectedNode.value = null
  try {
    const kw = searchText.value.trim() || '磁铁矿'
    const data = await getSubgraph(kw, hopCount.value)
    nodes.value = data.nodes || []
    edges.value = data.edges || []
    await nextTick()
    renderGraph()
  } catch (err) {
    console.error('图谱加载失败:', err)
  } finally {
    loading.value = false
  }
}

function renderGraph() {
  if (graph) { graph.destroy(); graph = null }

  const container = document.getElementById('g6-container')
  if (!container || nodes.value.length === 0) return

  const cx = container.clientWidth / 2
  const cy = container.clientHeight / 2
  const kw = searchText.value.trim()

  // 找到匹配搜索词的所有候选种子，优先精确匹配
  const candidates: Array<{ id: string; exact: boolean }> = []
  for (const n of nodes.value) {
    if (n.label === kw) candidates.push({ id: n.id, exact: true })
    else if (n.label.includes(kw) || kw.includes(n.label)) candidates.push({ id: n.id, exact: false })
  }

  // 只有一个主种子钉在中心，其余候选种子放 hop-1 环
  const primarySeed = candidates.find(c => c.exact)?.id ?? candidates[0]?.id
  const secondarySeedIds = new Set(
    candidates.filter(c => c.id !== primarySeed).map(c => c.id)
  )

  // 主种子作为唯一 hop-0 源点
  const seedIds = new Set<string>()
  if (primarySeed) seedIds.add(primarySeed)
  else if (nodes.value.length > 0) seedIds.add(nodes.value[0]!.id)

  // 计算跳数
  const hopDist = computeHopDistances(seedIds, nodes.value, edges.value)

  // 次种子强制放到 hop 1（与主种子直接相连的保持原距离）
  for (const sid of secondarySeedIds) {
    if (hopDist.get(sid)! > 1) hopDist.set(sid, 1)
  }

  // 按跳数分组，均匀分布在同心圆环上
  const ringRadius = [0, 150, 280, 420, 560]
  const rings = new Map<number, string[]>()
  for (const [id, d] of hopDist) {
    if (d >= 99) continue
    const r = Math.min(d, ringRadius.length - 1)
    if (!rings.has(r)) rings.set(r, [])
    rings.get(r)!.push(id)
  }

  const shortLabel = (s: string) => s.length > 10 ? s.slice(0, 9) + '…' : s

  // 预计算每个节点的初始位置（同心圆环，环内均匀散布）
  const positions = new Map<string, { x: number; y: number; fx?: number; fy?: number }>()
  for (const [ringId, ids] of rings) {
    const count = ids.length
    const radius = ringRadius[ringId] || 500
    ids.forEach((id, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2
      const jitter = count > 1 ? (Math.random() - 0.5) * 20 : 0
      const pos = {
        x: cx + (radius + jitter) * Math.cos(angle + jitter * 0.01),
        y: cy + (radius + jitter) * Math.sin(angle + jitter * 0.01),
      }
      if (ringId === 0) {
        // 仅主种子钉在中心
        pos.x = cx; pos.y = cy
        ;(pos as any).fx = cx; (pos as any).fy = cy
      }
      positions.set(id, pos)
    })
  }

  // 构建 G6 数据
  const g6Nodes = nodes.value
    .filter((n) => positions.has(n.id))
    .map((n) => {
      const d = hopDist.get(n.id) ?? 99
      const pos = positions.get(n.id)!
      const isSeed = d === 0
      const hasOwlType = Boolean(n.owlTypes?.length)
      const size = isSeed ? 52 : d === 1 ? 38 : 28
      return {
        id: n.id,
        data: {
          label: isSeed || d === 1 ? n.label : shortLabel(n.label),
          fullLabel: n.label,
          type: n.type,
          color: colorForType(n.type),
          hop: d,
          owlTypes: n.owlTypes || [],
        },
        style: {
          x: pos.x, y: pos.y,
          fill: colorForType(n.type),
          stroke: hasOwlType ? '#2E7D5B' : isSeed ? '#fff' : 'transparent',
          lineWidth: hasOwlType ? 3 : isSeed ? 3 : 0,
          labelText: isSeed || d === 1 ? n.label : shortLabel(n.label),
          labelFill: d <= 1 ? '#fff' : colorForType(n.type),
          labelFontSize: isSeed ? 12 : 10,
          labelFontFamily: 'Inter, PingFang SC, Microsoft YaHei, sans-serif',
          labelPlacement: (d <= 1 ? 'center' : 'bottom') as 'center' | 'bottom',
          labelOffsetY: d <= 1 ? 0 : 6,
          size,
        },
        ...(isSeed ? { fx: cx, fy: cy } : {}),
      }
    })

  const g6Edges = edges.value
    .filter((e) => positions.has(e.source) && positions.has(e.target))
    .map((e) => ({
      source: e.source,
      target: e.target,
      data: { label: e.label, inferred: e.inferred },
      style: {
        stroke: e.inferred ? '#C4BFAE' : '#D4D2CC',
        lineWidth: 1,
        lineDash: e.inferred ? [6, 4] : undefined,
        labelText: e.inferred ? `${e.label} (推测)` : e.label,
        labelFill: e.inferred ? '#AA9176' : '#6B6B78',
        labelFontSize: 8,
        labelBackground: true,
        labelBackgroundFill: '#FEFDF9',
        labelBackgroundOpacity: 0.9,
      },
    }))

  graph = new Graph({
    container: 'g6-container',
    width: container.clientWidth,
    height: container.clientHeight,
    autoFit: 'view',
    data: { nodes: g6Nodes, edges: g6Edges },
    layout: {
      type: 'd3-force',
      iterations: 300,
      linkDistance: (edge: any) => {
        const sHop = hopDist.get(edge.source) ?? 99
        const tHop = hopDist.get(edge.target) ?? 99
        if (sHop === 0 || tHop === 0) return 140
        return 110
      },
      nodeStrength: -800,
      collideStrength: 3,
      alphaDecay: 0.012,
      alpha: 1,
      nodeSize: 40,
    },
    animation: true,
    behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
    node: {
      state: {
        active: {
          halo: true,
          haloFill: '#2E7D5B',
          haloLineWidth: 0,
          haloOpacity: 0.3,
        },
      },
    },
  })

  graph.on('node:click', (evt: any) => {
    const id = evt.target?.id
    const node = nodes.value.find((n) => n.id === id)
    selectedNode.value = node || null
  })

  graph.on('canvas:click', () => {
    selectedNode.value = null
  })

  graph.render()
}

function handleSearch() {
  loadGraph()
}

function clearSelection() {
  selectedNode.value = null
}

let resizeTimer: ReturnType<typeof setTimeout>
function handleResize() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => renderGraph(), 300)
}

onMounted(() => {
  loadGraph()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  if (graph) { graph.destroy(); graph = null }
})
</script>

<template>
  <div class="graph-layout">
    <!-- 侧边栏 -->
    <aside class="panel">
      <div class="panel-title">知识图谱</div>
      <div class="search-box">
        <input v-model="searchText" placeholder="搜索实体..." @keydown.enter="handleSearch" />
        <select v-model="hopCount" @change="handleSearch" class="hop-select">
          <option :value="1">1 跳</option>
          <option :value="2">2 跳</option>
          <option :value="3">3 跳</option>
        </select>
      </div>

      <!-- 实体类型统计 -->
      <div class="filter-group">
        <div class="filter-label">实体类型</div>
        <div v-for="t in entityTypeStats()" :key="t.label" class="entity-item">
          <span class="dot" :style="{ background: t.color }" />
          {{ t.label }}
          <span class="count">{{ t.count }}</span>
        </div>
        <div v-if="nodes.length === 0 && !loading" class="empty-hint">暂无数据</div>
      </div>

      <div v-if="owlTypeStats().length" class="filter-group owl-filter-group">
        <div class="filter-label">本体推理</div>
        <div v-for="t in owlTypeStats()" :key="t.type" class="entity-item owl-stat-item">
          <span class="owl-ring" />
          {{ t.label }}
          <span class="count">{{ t.count }}</span>
        </div>
      </div>

      <!-- 关系类型统计 -->
      <div class="filter-group">
        <div class="filter-label">关系类型</div>
        <div v-for="t in relationTypeStats()" :key="t.label" class="entity-item">
          <span class="dot" style="background: var(--color-ink-200)" />
          {{ t.label }}
          <span class="count">{{ t.count }}</span>
        </div>
        <div v-if="edges.length === 0 && !loading" class="empty-hint">暂无数据</div>
      </div>

      <div class="hint-text">输入关键词按 Enter 搜索 · 点击节点查看属性</div>
    </aside>

    <!-- G6 画布 -->
    <div class="canvas">
      <div v-if="loading" class="loading-overlay">加载中...</div>
      <div v-if="!loading && nodes.length === 0" class="empty-overlay">输入关键词查看知识图谱</div>
      <div id="g6-container" class="g6-container" />

      <!-- 节点属性面板 -->
      <transition name="slide">
        <div v-if="selectedNode" class="detail-panel">
          <div class="detail-header">
            <span class="detail-title">实体属性</span>
            <button class="close-btn" @click="clearSelection">✕</button>
          </div>
          <div class="detail-body">
            <div class="detail-row">
              <span class="detail-label">名称</span>
              <span class="detail-value">{{ selectedNode?.label }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">类型</span>
              <span class="detail-value">
                <span class="type-badge" :style="{ background: colorForType(selectedNode?.type || '') }">{{ selectedNode?.type }}</span>
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">ID</span>
              <span class="detail-value mono">{{ selectedNode?.id }}</span>
            </div>
            <div v-if="selectedNode?.owlTypes?.length" class="detail-section owl-detail-section">
              <span class="detail-label">本体推理</span>
              <div class="owl-detail-list">
                <div v-for="type in selectedNode.owlTypes" :key="type" class="owl-detail-item">
                  <strong>{{ owlTypeMeta(type).label }}</strong>
                  <span>{{ owlTypeMeta(type).description }}</span>
                </div>
              </div>
            </div>
            <!-- 关联边 -->
            <div class="detail-section">
              <span class="detail-label">关联关系</span>
              <div v-for="(e, i) in selectedEdges" :key="i" class="edge-item" :class="{ inferred: e.inferred }">
                <span v-if="e.source === selectedNode?.id">→ [{{ e.label }}] → {{ nodes.find(n => n.id === e.target)?.label || e.target }}</span>
                <span v-else>{{ nodes.find(n => n.id === e.source)?.label || e.source }} → [{{ e.label }}] →</span>
                <small v-if="e.inferred">OWL 推理关系</small>
              </div>
              <div v-if="selectedEdges.length === 0" class="empty-hint">无关联关系</div>
            </div>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.graph-layout { display: flex; height: 100%; }

.panel {
  width: 220px; background: var(--color-bg-subtle);
  border-right: 1px solid var(--color-ink-100);
  display: flex; flex-direction: column; flex-shrink: 0; overflow-y: auto;
}

.panel-title { padding: 20px 20px 16px; font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--color-ink-900); border-bottom: 1px solid var(--color-ink-100); }

.search-box { padding: 12px 16px; border-bottom: 1px solid var(--color-ink-100); }
.search-box input { width: 100%; padding: 7px 10px; border: 1px solid var(--color-ink-100); border-radius: var(--radius-md); font-size: 13px; outline: none; background: var(--color-bg); font-family: var(--font-body); transition: border-color 0.2s; }
.search-box input:focus { border-color: var(--color-primary); }
.hop-select {
  margin-top: 6px; width: 100%; padding: 5px 8px; border: 1px solid var(--color-ink-100);
  border-radius: var(--radius-md); font-size: 12px; background: var(--color-bg);
  font-family: var(--font-body); color: var(--color-ink-700); outline: none; cursor: pointer;
}

.filter-group { padding: 14px 16px; }
.filter-label { font-size: 10px; color: var(--color-ink-500); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }

.entity-item { padding: 7px 10px; font-size: 13px; display: flex; align-items: center; gap: 8px; color: var(--color-ink-700); }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.count { margin-left: auto; font-size: 11px; color: var(--color-ink-300); }
.empty-hint { font-size: 12px; color: var(--color-ink-300); padding: 8px 10px; }
.hint-text { margin-top: auto; padding: 16px; font-size: 11px; color: var(--color-ink-300); text-align: center; border-top: 1px solid var(--color-ink-100); }

.owl-filter-group { border-top: 1px solid var(--color-ink-100); }
.owl-stat-item { color: var(--color-ink-700); }
.owl-ring {
  width: 10px;
  height: 10px;
  border: 2px solid var(--color-primary);
  border-radius: 50%;
  background: var(--color-surface);
  flex-shrink: 0;
}

.canvas { flex: 1; position: relative; overflow: hidden; }
.g6-container { width: 100%; height: 100%; }
.loading-overlay, .empty-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 14px; color: var(--color-ink-300); z-index: 10; background: var(--color-bg); }

/* 属性面板 */
.detail-panel {
  position: absolute; top: 16px; right: 16px; width: 260px; max-height: calc(100% - 32px);
  background: var(--color-surface); border: 1px solid var(--color-ink-100);
  border-radius: var(--radius-md); box-shadow: var(--shadow-md); overflow-y: auto; z-index: 20;
}
.detail-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--color-ink-100); }
.detail-title { font-family: var(--font-display); font-size: 14px; font-weight: 600; color: var(--color-ink-900); }
.close-btn { width: 24px; height: 24px; border: none; background: none; cursor: pointer; font-size: 14px; color: var(--color-ink-300); }
.close-btn:hover { color: var(--color-ink-700); }
.detail-body { padding: 16px; }
.detail-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--color-ink-50); }
.detail-label { font-size: 11px; color: var(--color-ink-500); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.detail-value { font-size: 13px; color: var(--color-ink-900); max-width: 150px; word-break: break-all; }
.detail-value.mono { font-family: monospace; font-size: 11px; }
.type-badge { display: inline-block; padding: 2px 8px; border-radius: var(--radius-md); color: #fff; font-size: 11px; font-weight: 500; }
.detail-section { margin-top: 12px; }
.edge-item { padding: 6px 0; font-size: 12px; color: var(--color-ink-700); border-bottom: 1px solid var(--color-ink-50); word-break: break-all; }
.edge-item.inferred { color: var(--color-accent); }
.edge-item small { display: block; margin-top: 2px; color: var(--color-warning); font-size: 9px; }

.owl-detail-section {
  padding: 12px 0;
  border-bottom: 1px solid var(--color-ink-50);
}
.owl-detail-list { margin-top: 8px; }
.owl-detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 0;
  border-top: 1px solid var(--color-ink-50);
}
.owl-detail-item strong { color: var(--color-primary); font-size: 12px; font-weight: 600; }
.owl-detail-item span { color: var(--color-ink-500); font-size: 10px; line-height: 1.5; }

.slide-enter-active, .slide-leave-active { transition: all 0.25s ease; }
.slide-enter-from, .slide-leave-to { opacity: 0; transform: translateX(20px); }
</style>
