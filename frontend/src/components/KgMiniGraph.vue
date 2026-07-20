<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import { Graph } from '@antv/g6'
import { getSubgraph, type GraphNode, type GraphEdge } from '@/api/kg'
import type { KGPath } from '@/types'
import { sanitizeSubgraph } from '@/utils/kg-graph'
import { owlTypeMeta, summarizeOwlEvidence } from '@/utils/owl'

const props = defineProps<{
  kgContext: KGPath[]
  question?: string
  autoExpand?: boolean
}>()

const collapsed = ref(!props.autoExpand)
// 用户手动 toggle 后置 true，此后不再被 autoExpand 自动翻转覆盖
const userInteracted = ref(false)
const fullscreen = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const nodes = ref<GraphNode[]>([])
const edges = ref<GraphEdge[]>([])
const graphEl = ref<HTMLDivElement | null>(null)
const fullscreenEl = ref<HTMLDivElement | null>(null)

const pathOwlEvidence = computed(() => summarizeOwlEvidence(props.kgContext))
const owlLabels = computed(() => {
  const types = new Set(pathOwlEvidence.value.map((item) => item.type))
  for (const node of nodes.value) {
    for (const type of node.owlTypes || []) types.add(type)
  }
  return [...types].map((type) => owlTypeMeta(type).label)
})
const owlNodeCount = computed(() => nodes.value.filter((node) => node.owlTypes?.length).length)
const hasInferredEdges = computed(
  () => props.kgContext.some((path) => path.inferred) || edges.value.some((edge) => edge.inferred)
)

// 全组件同一时刻只保留一个 G6 实例：内联 ↔ 全屏切换时销毁旧的再建新的，
// 收起 / 卸载时立即 destroy → 历史消息零常驻实例，杜绝多轮问答后 OOM。
let graph: Graph | null = null

// ---- 关键词提取 ----
const searchKeyword = computed(() => {
  const names = new Set<string>()
  for (const p of props.kgContext) {
    if (p.from && p.from.length >= 2) names.add(p.from)
    if (p.to && p.to.length >= 2) names.add(p.to)
  }
  const arr = [...names]
  const long = arr.filter((n) => n.length >= 3)
  return long[0] || arr[0] || props.question?.slice(0, 20) || ''
})

// ---- 配色 ----
const typeColors: Record<string, string> = {
  Mineral: '#B83A1F', Rock: '#B8860B', Structure: '#1E3A5F',
  TimePeriod: '#2E5D3A', DepositType: '#7B4B94', Region: '#4A6FA5',
}
const defaultColor = '#6B6B78'
function colorForType(type: string): string { return typeColors[type] || defaultColor }

// ---- 加载子图 ----
async function loadGraph() {
  const kw = searchKeyword.value
  if (!kw || loading.value) return
  loading.value = true
  error.value = null
  try {
    const data = await getSubgraph(kw, 1)
    const safe = sanitizeSubgraph(data.nodes || [], data.edges || [], 40)
    nodes.value = safe.nodes
    edges.value = safe.edges
    // 按接口顺序限制节点数量，并同步移除端点不在保留集合中的边。
    if (nodes.value.length === 0) { error.value = '暂无图谱数据'; return }
  } catch (err: any) {
    error.value = err?.message || '图谱加载失败'
  } finally { loading.value = false }
  // loading 置回 false 后画布容器才会挂载（v-if 依赖 !loading），必须等这一步之后再 render，
  // 否则 waitForEl 轮询期间容器还不存在，会静默早退导致图谱悬空不显示。
  if (!error.value && nodes.value.length > 0) await render()
}

function shortLabel(s: string): string {
  return s.length > 8 ? s.slice(0, 7) + '…' : s
}

// 等模板 ref 挂载：v-if 翻转或 <Teleport to="body"> 异步挂载时，单次 nextTick 不一定够，
// 追加 RAF 轮询兜底。G6 实例必须等 container DOM 就绪才能渲染，否则 render() 静默早退 → 全屏空窗。
async function waitForEl(getEl: () => HTMLElement | null): Promise<HTMLElement | null> {
  await nextTick()
  let el = getEl()
  if (el) return el
  for (let i = 0; i < 4 && !el; i++) {
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    el = getEl()
  }
  return el
}

// ---- G6 数据构建（静态同心圆环，坐标预算 + 全节点 fx/fy 锁定 → 零仿真）----
function buildG6Data(width: number, height: number, isFullscreen: boolean) {
  const kw = searchKeyword.value
  const seed = nodes.value.find(
    (n) => n.label === kw || n.label.includes(kw) || kw.includes(n.label)
  )
  const seedId = seed?.id ?? nodes.value[0]?.id

  const adj = new Map<string, string[]>()
  for (const n of nodes.value) adj.set(n.id, [])
  for (const e of edges.value) {
    if (!adj.has(e.source) || !adj.has(e.target)) continue
    adj.get(e.source)!.push(e.target)
    adj.get(e.target)!.push(e.source)
  }

  // BFS 跳数：种子=0，不可达=99
  const hop = new Map<string, number>()
  hop.set(seedId!, 0)
  const queue = [seedId!]
  let head = 0
  while (head < queue.length) {
    const cur = queue[head++]!
    const d = hop.get(cur)! + 1
    for (const nb of adj.get(cur) || []) {
      if (!hop.has(nb)) { hop.set(nb, d); queue.push(nb) }
    }
  }
  for (const n of nodes.value) { if (!hop.has(n.id)) hop.set(n.id, 99) }

  const cx = width / 2; const cy = height / 2
  // 全屏用大环、内联用小环；均为固定像素，不随仿真变动
  const ringRadius = isFullscreen
    ? [0, 150, 280, 420, 560]
    : [0, 70, 130, 190, 240]
  const nodeSizes = isFullscreen ? [46, 34, 26] : [34, 24, 18]

  const g6Nodes = nodes.value
    .filter((n) => hop.has(n.id) && hop.get(n.id)! < 99)
    .map((n, _i, arr) => {
      const d = Math.min(hop.get(n.id)!, ringRadius.length - 1)
      const ringNodes = arr.filter((x) => Math.min(hop.get(x.id)!, ringRadius.length - 1) === d)
      const idx = ringNodes.indexOf(n)
      const angle = (2 * Math.PI * idx) / ringNodes.length - Math.PI / 2
      const r = ringRadius[d]!
      const px = d === 0 ? cx : cx + r * Math.cos(angle)
      const py = d === 0 ? cy : cy + r * Math.sin(angle)
      const size = nodeSizes[Math.min(d, nodeSizes.length - 1)]!
      const hasOwlType = Boolean(n.owlTypes?.length)
      return {
        id: n.id,
        // 全节点锁定 fx/fy → d3-force 不施力，节点恒定在预算坐标（配合 iterations:1 完全静态）
        fx: px, fy: py,
        data: {
          label: d <= 1 ? n.label : shortLabel(n.label),
          type: n.type,
          hop: d,
          owlTypes: n.owlTypes || [],
        },
        style: {
          x: px, y: py,
          fill: colorForType(n.type),
          stroke: hasOwlType ? '#2E7D5B' : d === 0 ? '#fff' : 'transparent',
          lineWidth: hasOwlType ? 2.5 : d === 0 ? 2.5 : 0,
          size,
          labelText: d <= 1 ? n.label : shortLabel(n.label),
          labelFill: d <= 1 ? '#fff' : colorForType(n.type),
          labelFontSize: d === 0 ? 11 : 9,
          labelFontFamily: 'Inter, PingFang SC, Microsoft YaHei, sans-serif',
          labelPlacement: (d <= 1 ? 'center' : 'bottom') as 'center' | 'bottom',
          labelOffsetY: d <= 1 ? 0 : 5,
        },
      }
    })

  const renderedNodeIds = new Set(g6Nodes.map((node) => node.id))
  const g6Edges = edges.value
    .filter((e) => renderedNodeIds.has(e.source) && renderedNodeIds.has(e.target))
    .map((e) => ({
      source: e.source, target: e.target,
      style: {
        stroke: e.inferred ? '#C4BFAE' : '#D4D2CC', lineWidth: 1,
        lineDash: e.inferred ? [5, 3] : undefined,
        labelText: e.label, labelFill: '#6B6B78', labelFontSize: 7,
        labelBackground: true, labelBackgroundFill: '#FEFDF9', labelBackgroundOpacity: 0.85,
      },
    }))

  return { g6Nodes, g6Edges, hop }
}

// ---- 统一渲染：按当前视图（内联 / 全屏）挂到对应容器，同一时刻仅一个实例 ----
async function render() {
  if (graph) { graph.destroy(); graph = null }
  if (nodes.value.length === 0) return

  const isFullscreen = fullscreen.value
  // 内联收起时不渲染
  if (!isFullscreen && collapsed.value) return

  const el = await waitForEl(() => (isFullscreen ? fullscreenEl.value : graphEl.value))
  if (!el || el.clientWidth === 0) return
  // 视图可能在等待期间被切走（如刚开全屏又秒关），以最新状态为准，避免挂错容器
  if (fullscreen.value !== isFullscreen) return

  const width = el.clientWidth
  const height = isFullscreen ? (el.clientHeight || 600) : 300
  const { g6Nodes, g6Edges } = buildG6Data(width, height, isFullscreen)

  try {
    graph = new Graph({
      container: el,
      width, height, autoFit: 'view',
      data: { nodes: g6Nodes, edges: g6Edges },
      // 固定坐标 + 全节点 fx/fy 锁定：d3-force 仅跑 1 帧即定格，零持续 CPU
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
}

// ---- 操作 ----
function toggleCollapse() {
  userInteracted.value = true
  collapsed.value = !collapsed.value
  if (!collapsed.value) {
    // 展开 → 数据未加载则先加载（loadGraph 内部会 render），否则直接渲染
    if (nodes.value.length === 0) loadGraph()
    else render()
  }
  // 收起 → 由下方 watch(collapsed) 统一销毁 G6
}

async function openFullscreen() {
  // 销毁内联实例后再建全屏实例 → 任一时刻仅一个 G6，杜绝双力导向图 OOM
  if (graph) { graph.destroy(); graph = null }
  fullscreen.value = true
  document.addEventListener('keydown', onEsc)
  // render() 内部用 waitForEl 轮询等待 <Teleport to="body"> 的 ref 挂载，避免全屏空窗
  await render()
}

function closeFullscreen() {
  fullscreen.value = false
  document.removeEventListener('keydown', onEsc)
  // 关闭全屏 → 销毁全屏实例，若内联未收起则重建内联实例
  if (graph) { graph.destroy(); graph = null }
  if (!collapsed.value && nodes.value.length > 0) render()
}

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') closeFullscreen()
}

// ---- 生命周期 ----
onMounted(() => {
  if (props.kgContext.length > 0) loadGraph()
})

// kgContext 变化时重新加载（流式 onDone 延迟补丁时触发）
watch(() => props.kgContext, (kg) => {
  if (kg.length > 0 && nodes.value.length === 0 && !loading.value) loadGraph()
})

// autoExpand 翻转（该消息从「最后一条」变为「历史消息」或反之）→ 联动收起 / 展开。
// 历史消息收起即销毁 G6，避免多轮问答后 OOM。用户手动 toggle 后不再被 autoExpand 覆盖。
watch(() => props.autoExpand, (newAuto) => {
  if (userInteracted.value) return
  if (!newAuto && !collapsed.value) {
    collapsed.value = true // 触发下方 collapsed watcher 释放 G6
  } else if (newAuto && collapsed.value && nodes.value.length > 0) {
    collapsed.value = false
    render() // render 内部 waitForEl 等 v-if 翻转后的 graphEl 挂载
  }
})

// 收起时统一释放 G6 实例（手动收起 / autoExpand 收起都走这里）
watch(collapsed, (now) => {
  if (now && graph) { graph.destroy(); graph = null }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onEsc)
  if (graph) { graph.destroy(); graph = null }
})
</script>

<template>
  <div v-if="kgContext.length > 0" class="kg-mini">
    <!-- 标题栏 -->
    <div class="kg-mini-head">
      <div class="kg-mini-title">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <circle cx="5" cy="5" r="2" /><circle cx="15" cy="5" r="2" />
          <circle cx="5" cy="15" r="2" /><circle cx="15" cy="15" r="2" />
          <line x1="7" y1="5" x2="13" y2="5" />
          <line x1="5" y1="7" x2="5" y2="13" />
          <line x1="15" y1="7" x2="15" y2="13" />
          <line x1="7" y1="15" x2="13" y2="15" />
        </svg>
        知识图谱 · 「{{ searchKeyword }}」
        <span v-if="!loading && nodes.length > 0" class="meta-inline">{{ nodes.length }} 节点 · {{ edges.length }} 边</span>
        <span v-if="owlLabels.length" class="owl-inline">本体 {{ owlLabels.length }} 类</span>
      </div>
      <div class="kg-mini-actions">
        <!-- 按钮1：展开/收起 -->
        <button
          class="kg-btn"
          :title="collapsed ? '展开图谱' : '收起图谱'"
          :disabled="loading"
          @click.stop="toggleCollapse"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" class="btn-icon" :class="{ up: !collapsed }">
            <path d="M6 8l4 4 4-4" />
          </svg>
        </button>
        <!-- 按钮2：全屏放大 -->
        <button
          class="kg-btn primary"
          title="全屏放大查看"
          :disabled="loading || nodes.length === 0"
          @click.stop="openFullscreen"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
          </svg>
          <span class="btn-label">放大</span>
        </button>
      </div>
    </div>

    <!-- 加载 -->
    <div v-if="loading" class="kg-mini-state">加载图谱中...</div>
    <!-- 错误 -->
    <div v-else-if="error" class="kg-mini-state error">{{ error }}</div>
    <div v-else-if="!collapsed && nodes.length > 0 && (owlNodeCount || hasInferredEdges)" class="kg-mini-legend">
      <span v-if="owlNodeCount" class="legend-item">
        <i class="legend-node" />{{ owlNodeCount }} 个本体推理节点
      </span>
      <span v-if="hasInferredEdges" class="legend-item">
        <i class="legend-edge" />OWL 推理关系
      </span>
    </div>
    <!-- 内联画布（v-if 确保 DOM 完全销毁/重建，避免 G6 残留） -->
    <div
      v-if="!collapsed && !loading && !error && nodes.length > 0"
      ref="graphEl"
      class="kg-mini-canvas"
    />

    <!-- 全屏弹窗 -->
    <Teleport to="body">
      <div v-if="fullscreen" class="kg-fullscreen-overlay" @click.self="closeFullscreen">
        <div class="kg-fullscreen-panel">
          <div class="kg-fullscreen-head">
            <span class="kg-fullscreen-title">知识图谱 · 「{{ searchKeyword }}」</span>
            <span class="fs-stat">{{ nodes.length }} 节点 · {{ edges.length }} 边</span>
            <span v-if="owlLabels.length" class="fs-owl">本体 {{ owlLabels.join(' / ') }}</span>
            <button class="kg-btn close" title="关闭 (Esc)" @click="closeFullscreen">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          </div>
          <div ref="fullscreenEl" class="kg-fullscreen-canvas" />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.kg-mini {
  margin-top: 14px;
  border: 1px solid var(--color-ink-100);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  overflow: hidden;
}

/* ---- 标题栏 ---- */
.kg-mini-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--color-bg-subtle);
  gap: 12px;
}

.kg-mini-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink-700);
  min-width: 0;
  flex-shrink: 1;
}
.kg-mini-title svg { width: 15px; height: 15px; color: var(--color-accent); flex-shrink: 0; }

.meta-inline {
  font-size: 10px;
  font-weight: 400;
  color: var(--color-ink-400);
  letter-spacing: 0.03em;
}

.owl-inline {
  padding-left: 6px;
  border-left: 1px solid var(--color-ink-100);
  color: var(--color-primary);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.kg-mini-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* ---- 按钮 ---- */
.kg-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 7px;
  border: 1px solid var(--color-ink-100);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  cursor: pointer;
  color: var(--color-ink-500);
  transition: all 0.15s;
  flex-shrink: 0;
  font-size: 11px;
  font-family: var(--font-body);
  white-space: nowrap;
}
.kg-btn:hover { background: var(--color-ink-50); border-color: var(--color-ink-200); color: var(--color-ink-700); }
.kg-btn:disabled { opacity: 0.3; cursor: not-allowed; pointer-events: none; }

/* 全屏放大按钮 — 强调色 */
.kg-btn.primary {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.kg-btn.primary:hover:not(:disabled) { background: var(--color-accent-light); }

/* 关闭按钮 */
.kg-btn.close:hover { border-color: var(--color-danger); color: var(--color-danger); background: var(--color-danger-light); }

.kg-btn .btn-icon { width: 14px; height: 14px; transition: transform 0.2s; }
.kg-btn .btn-icon.up { transform: rotate(180deg); }

.btn-label { font-weight: 500; letter-spacing: 0.03em; }

/* ---- 内联画布 ---- */
.kg-mini-canvas {
  width: 100%;
  height: 300px;
  border-top: 1px solid var(--color-ink-50);
}

.kg-mini-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 30px;
  padding: 6px 12px;
  border-top: 1px solid var(--color-ink-50);
  color: var(--color-ink-300);
  font-size: 10px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-node {
  width: 9px;
  height: 9px;
  border: 2px solid var(--color-primary);
  border-radius: 50%;
  background: var(--color-surface);
}

.legend-edge {
  width: 18px;
  height: 0;
  border-top: 1px dashed var(--color-warning);
}

/* ---- 状态提示 ---- */
.kg-mini-state {
  padding: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--color-ink-400);
  border-top: 1px solid var(--color-ink-50);
}
.kg-mini-state.error { color: var(--color-danger); }

/* ---- 全屏弹窗 ---- */
.kg-fullscreen-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.15s;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.kg-fullscreen-panel {
  width: 90vw;
  height: 85vh;
  background: var(--color-surface);
  border: 1px solid var(--color-ink-100);
  border-radius: var(--radius-md);
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.kg-fullscreen-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-ink-100);
  background: var(--color-bg-subtle);
  flex-shrink: 0;
}
.kg-fullscreen-title {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
  color: var(--color-ink-900);
  flex: 1;
}
.fs-stat {
  font-size: 11px;
  color: var(--color-ink-400);
}

.fs-owl {
  color: var(--color-primary);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.kg-fullscreen-canvas {
  flex: 1;
  min-height: 0;
}

@media (max-width: 640px) {
  .meta-inline { display: none; }
  .owl-inline { margin-left: auto; }
  .btn-label { display: none; }
  .fs-owl { display: none; }
}
</style>
