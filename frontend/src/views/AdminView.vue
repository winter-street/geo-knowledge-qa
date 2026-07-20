<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import type {
  Document,
  RetrievalCapabilityStatus,
  RetrievalConfigResponse,
  RuntimeRetrievalSettings,
} from '@/types'
import { getDocList } from '@/api/doc'
import { uploadDoc } from '@/api/doc'
import { getRetrievalConfig, saveRetrievalConfig } from '@/api/retrieval-config'
import { toRuntimeSettingsPayload, validateRuntimeSettingsForm } from '@/utils/retrieval-config'
import StatCard from '@/components/StatCard.vue'
import ChartPanel from '@/components/ChartPanel.vue'
import { ElMessage, ElMessageBox } from 'element-plus'

// ---- 本地数据类型（取代原来的 any，恢复类型安全）----
interface EntityRow {
  entityId: string
  name: string
  type: string
  relationCount: number
  sourceDoc: string
  status: string
}

interface QaLogRow {
  id: string
  question: string
  pathUsed: string[]
  hitDocs: number
  kgCount: number
  spatialCount: number
  ragMode?: string | null
  ragWeight?: number
  kgWeight?: number
  spatialWeight?: number
  latency: number
  satisfaction: string | null
  createdAt: string
}

interface AdminStats {
  docCount: number
  chunkCount: number
  entityCount: number
  qaCount: number
}

const docs = ref<Document[]>([])
const entities = ref<EntityRow[]>([])
const config = ref<RetrievalConfigResponse | null>(null)
const configForm = ref<RuntimeRetrievalSettings | null>(null)
const configErrors = ref<Partial<Record<keyof RuntimeRetrievalSettings, string>>>({})
const configLoadError = ref('')
const logs = ref<QaLogRow[]>([])
const stats = ref<AdminStats | null>(null)

// 服务状态
const serviceStatus = ref<Record<string, any>>({})

const activeTab = ref('docs')
const uploading = ref(false)
const refreshing = ref(false)
const configSaving = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

/** 选择文件后自动上传 */
async function handleUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return

  if (!file.name.endsWith('.pdf')) {
    ElMessage.warning('仅支持 PDF 文件')
    return
  }

  uploading.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    const result = await uploadDoc(form)
    ElMessage.success(`「${result.filename}」上传成功，后台正在处理...`)

    // 刷新文档列表
    docs.value = await getDocList()
  } catch (err: any) {
    ElMessage.error(err?.message || '上传失败')
  } finally {
    uploading.value = false
    // 清空 input 以便重复上传同一文件
    if (fileInput.value) fileInput.value.value = ''
  }
}

const statusMap: Record<string, { label: string; class: string }> = {
  completed: { label: '已完成', class: 'done' },
  processing: { label: '处理中', class: 'processing' },
  pending: { label: '待处理', class: 'pending' },
  failed: { label: '失败', class: 'failed' },
  verified: { label: '已审核', class: 'done' },
}

const satisfactionMap: Record<string, { label: string; class: string }> = {
  good: { label: '满意', class: 'done' },
  poor: { label: '不满意', class: 'failed' },
}

const pathLabelMap: Record<string, string> = {
  bge: 'BGE',
  tfidf: 'TF-IDF',
  bm25: 'BM25',
  bert: 'BERT',
  kg: '图谱',
  ontology: '本体',
  spatial: '空间',
}

// 安全查表：严格模式下 Record 索引结果是 T | undefined，这里统一兜底，避免模板里出现未定义索引类型报错
function statusTag(status: string): { label: string; class: string } {
  return statusMap[status] ?? { label: status || '—', class: '' }
}

function entityStatusTag(status: string): { label: string; class: string } {
  if (status === 'pending') return { label: '待审核', class: 'pending' }
  return statusTag(status)
}

function satisfactionTag(s: string | null | undefined): { label: string; class: string } {
  return (s && satisfactionMap[s]) || { label: '—', class: '' }
}

/**
 * 统一的 JSON 拉取：检查 res.ok，失败（网络错误 / 404 / 解析异常）时回退到兜底值，
 * 且自身永不抛错——这样多个数据源之间互不影响。
 */
async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } catch (err) {
    console.warn(`[admin] 加载 ${url} 失败，已使用兜底数据`, err)
    return fallback
  }
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function fetchEntityRows(): Promise<EntityRow[]> {
  const res = await fetch('/api/admin/entities', { headers: authHeaders() })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  if (!Array.isArray(data)) throw new Error('实体列表格式错误')
  return data.filter((item): item is EntityRow =>
    item && typeof item.entityId === 'string' && item.entityId.length > 0
  )
}

async function refreshAdminData(showSuccess = false) {
  refreshing.value = true
  // 服务健康状态
  try {
    const res = await fetch('/api/health/detailed', {
      headers: authHeaders(),
    })
    if (res.ok) serviceStatus.value = await res.json()
  } catch { /* 忽略 */ }

  // 文档列表：优先后端接口，失败则回退到本地 mock
  try {
    docs.value = await getDocList()
  } catch (err) {
    console.warn('[admin] /admin/docs 不可用，已回退到本地 mock', err)
    docs.value = await fetchJson<Document[]>('/mock/doc-list.json', [])
  }

  // 先后端再 mock 的降级加载（与 getDocList 策略一致）
  async function fetchWithBackendFallback<T>(apiPath: string, mockPath: string, fallback: T): Promise<T> {
    try {
      const res = await fetch(apiPath, {
        headers: authHeaders(),
      })
      if (res.ok) return (await res.json()) as T
    } catch { /* 回退 mock */ }
    return fetchJson<T>(mockPath, fallback)
  }

  // 实体 / 配置 / 日志彼此独立；检索配置必须来自真实后端，不用 mock 掩盖错误。
  const [statsData, entityResult, configResult, logData] = await Promise.all([
    fetchWithBackendFallback<AdminStats>('/api/admin/stats', '/mock/admin-stats.json', { docCount: 0, chunkCount: 0, entityCount: 0, qaCount: 0 }),
    fetchEntityRows()
      .then((data) => ({ data, error: null }))
      .catch((error: Error) => ({ data: [] as EntityRow[], error })),
    getRetrievalConfig()
      .then((data) => ({ data, error: null }))
      .catch((error: Error) => ({ data: null, error })),
    fetchWithBackendFallback<QaLogRow[]>('/api/admin/qa-logs', '/mock/qa-logs.json', []),
  ])
  stats.value = statsData
  entities.value = entityResult.data
  config.value = configResult.data
  configForm.value = configResult.data ? { ...configResult.data.settings } : null
  configLoadError.value = configResult.error?.message || ''
  logs.value = logData
  refreshing.value = false
  if (entityResult.error) {
    console.warn('[admin] 实体列表加载失败', entityResult.error)
    ElMessage.error('实体数据加载失败，请检查 Neo4j 连接后刷新')
  }
  if (showSuccess) ElMessage.success('数据已刷新')
}

onMounted(() => { void refreshAdminData() })

// ---- 文档查看弹窗 ----
const docDetailVisible = ref(false)
const docDetail = ref<{ title: string; chunks: any[] } | null>(null)

// ---- 实体查看/编辑弹窗 ----
const entityViewVisible = ref(false)
const entityView = ref<Record<string, any> | null>(null)
const entityEditVisible = ref(false)
const entityEdit = ref<{ entityId: string; name: string; type: string; description?: string; status?: string } | null>(null)
const entitySaving = ref(false)
const deletingEntityIds = ref<Set<string>>(new Set())

function isEntityDeleting(entityId: string): boolean {
  return deletingEntityIds.value.has(entityId)
}

function setEntityDeleting(entityId: string, deleting: boolean) {
  const next = new Set(deletingEntityIds.value)
  if (deleting) next.add(entityId)
  else next.delete(entityId)
  deletingEntityIds.value = next
}

async function viewDoc(doc: Document) {
  try {
    const token = localStorage.getItem('token')
    const res = await fetch(`/api/admin/docs/${doc.docId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error('加载失败')
    const data = await res.json()
    docDetail.value = { title: data.title, chunks: data.chunks || [] }
    docDetailVisible.value = true
  } catch (err: any) {
    ElMessage.error(err.message || '加载文档详情失败')
  }
}

async function deleteDocItem(doc: Document) {
  try {
    await ElMessageBox.confirm(`确定删除「${doc.title.slice(0, 30)}...」吗？该操作不可恢复。`, '确认删除', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning',
    })
  } catch { return }
  try {
    const res = await fetch(`/api/admin/docs/${doc.docId}`, {
      method: 'DELETE', headers: authHeaders(),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || '删除失败')
    }
    docs.value = docs.value.filter((item) => item.docId !== doc.docId)
    if (stats.value) {
      stats.value = {
        ...stats.value,
        docCount: Math.max(0, stats.value.docCount - 1),
        chunkCount: Math.max(0, stats.value.chunkCount - doc.chunkCount),
      }
    }
    ElMessage.success('已删除')
  } catch (err: any) {
    ElMessage.error(err.message || '删除失败')
  }
}

/** 从后端加载实体详情 */
async function fetchEntityDetail(entityId: string): Promise<Record<string, any> | null> {
  try {
    const token = localStorage.getItem('token')
    const res = await fetch(`/api/admin/entities/${encodeURIComponent(entityId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

async function viewEntity(e: EntityRow) {
  const detail = await fetchEntityDetail(e.entityId)
  entityView.value = detail || { name: e.name, type: e.type, relationCount: e.relationCount, sourceDoc: e.sourceDoc, status: e.status }
  entityViewVisible.value = true
}

async function editEntity(e: EntityRow) {
  const detail = await fetchEntityDetail(e.entityId)
  entityEdit.value = {
    entityId: e.entityId,
    name: detail?.name || e.name,
    type: detail?.type || e.type,
    description: detail?.description || '',
    status: detail?.status || e.status || 'verified',
  }
  entityEditVisible.value = true
}

async function saveEntity() {
  if (!entityEdit.value) return
  const editing = { ...entityEdit.value }
  entitySaving.value = true
  try {
    const token = localStorage.getItem('token')
    const res = await fetch(`/api/admin/entities/${encodeURIComponent(editing.entityId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        name: editing.name,
        description: editing.description,
        status: editing.status,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || '保存失败')
    entities.value = entities.value.map((item) => item.entityId === editing.entityId
      ? {
          ...item,
          name: data.entity?.name ?? editing.name,
          status: data.entity?.status ?? editing.status ?? item.status,
        }
      : item
    )
    ElMessage.success('已保存')
    entityEditVisible.value = false
  } catch (err: any) {
    ElMessage.error(err.message || '保存失败')
  } finally {
    entitySaving.value = false
  }
}

async function deleteEntityItem(e: EntityRow) {
  if (isEntityDeleting(e.entityId)) return
  const confirmed = window.confirm(`确定删除实体「${e.name}」吗？\n该实体的 ${e.relationCount} 条关联关系也会被删除，且无法恢复。`)
  if (!confirmed) return

  setEntityDeleting(e.entityId, true)
  try {
    const res = await fetch(`/api/admin/entities/${encodeURIComponent(e.entityId)}`, {
      method: 'DELETE', headers: authHeaders(),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || '删除失败')
    }
    entities.value = entities.value.filter((item) => item.entityId !== e.entityId)
    if (stats.value) {
      stats.value = {
        ...stats.value,
        entityCount: Math.max(0, stats.value.entityCount - 1),
      }
    }
    ElMessage.success('已删除')
  } catch (err: any) {
    ElMessage.error(err.message || '删除失败')
  } finally {
    setEntityDeleting(e.entityId, false)
  }
}

async function saveRuntimeConfig() {
  if (!configForm.value) return
  const errors = validateRuntimeSettingsForm(configForm.value)
  configErrors.value = errors
  const firstError = Object.values(errors)[0]
  if (firstError) {
    ElMessage.warning(firstError)
    return
  }
  configSaving.value = true
  try {
    const data = await saveRetrievalConfig(toRuntimeSettingsPayload(configForm.value))
    config.value = data
    configForm.value = { ...data.settings }
    configErrors.value = {}
    ElMessage.success(data.message || '运行时配置已保存')
  } catch (err: any) {
    ElMessage.error(err.message || '配置保存失败')
  } finally {
    configSaving.value = false
  }
}

function capability(key: RetrievalCapabilityStatus['key']): RetrievalCapabilityStatus | undefined {
  return config.value?.capabilities.find((item) => item.key === key)
}

function formatConfigTime(value: string | null | undefined): string {
  if (!value) return '尚未保存，当前使用启动默认值'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

const totalRetrievalWeight = computed(() => {
  if (!configForm.value) return 0
  return configForm.value.ragWeight + configForm.value.kgWeight + configForm.value.spatialWeight
})

function exportLogs() {
  const headers = ['问题', '检索路径', 'RAG命中', 'KG命中', '空间命中', 'RAG权重', 'KG权重', '空间权重', '耗时(ms)', '时间']
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const rows = logs.value.map((log) => [
    log.question,
    log.pathUsed.map((path) => pathLabelMap[path] || path).join('、'),
    log.hitDocs,
    log.kgCount,
    log.spatialCount,
    log.ragWeight ?? 0,
    log.kgWeight ?? 0,
    log.spatialWeight ?? 0,
    log.latency,
    log.createdAt,
  ])
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  link.download = `问答日志-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

function typeColor(t: string): string {
  const c: Record<string,string> = { Mineral:'#B83A1F', Rock:'#2E7D5B', Structure:'#1E3A5F', TimePeriod:'#B8860B', DepositType:'#8B5CF6' }
  return c[t] || '#6B6B78'
}

const totalChunks = computed(() => docs.value.reduce((sum, d) => sum + d.chunkCount, 0))

// ====== ECharts 图表配置 ======

/** 文档类型分布 — 饼图 */
const docTypeChartOption = computed(() => {
  const map: Record<string, number> = {}
  for (const d of docs.value) {
    map[d.docType] = (map[d.docType] || 0) + 1
  }
  return {
    title: { text: '文档类型分布', left: 'center', textStyle: { fontSize: 14, color: '#1A1A2E', fontFamily: 'Source Serif 4, serif' } },
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, textStyle: { color: '#6B6B78', fontSize: 11 } },
    color: ['#2E7D5B', '#1E3A5F', '#B8860B', '#B83A1F', '#6B6B78'],
    series: [{
      type: 'pie', radius: ['45%', '70%'], center: ['50%', '50%'], avoidLabelOverlap: false,
      label: { show: false },
      itemStyle: { borderRadius: 2, borderColor: '#fff', borderWidth: 2 },
      data: Object.entries(map).map(([name, value]) => ({ name, value })),
    }],
  }
})

/** 检索路径使用统计 — 柱状图 */
const retrievalChartOption = computed(() => {
  const settings = config.value?.settings
  const labels = settings ? [settings.ragMode.toUpperCase(), '知识图谱', '空间'] : []
  const weights = settings ? [settings.ragWeight, settings.kgWeight, settings.spatialWeight] : []
  const enabledFlags = settings ? [settings.ragEnabled, settings.kgEnabled, settings.spatialEnabled] : []
  return {
    title: { text: '检索路径权重配置', left: 'center', textStyle: { fontSize: 14, color: '#1A1A2E', fontFamily: 'Source Serif 4, serif' } },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: labels, axisLabel: { color: '#6B6B78', fontSize: 10 } },
    yAxis: { type: 'value', max: 1, axisLabel: { color: '#6B6B78', fontSize: 10 } },
    color: ['#2E7D5B'],
    series: [{
      type: 'bar', data: weights.map((w, i) => ({ value: w, itemStyle: { color: enabledFlags[i] ? '#2E7D5B' : '#D4D2CC' } })),
      barWidth: '50%', itemStyle: { borderRadius: [4, 4, 0, 0] },
    }],
    grid: { top: 40, bottom: 30, left: 40, right: 20 },
  }
})

/** 问答耗时趋势 — 折线图 */
const qaTimeChartOption = computed(() => {
  const sorted = [...logs.value].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return {
    title: { text: '问答耗时趋势', left: 'center', textStyle: { fontSize: 14, color: '#1A1A2E', fontFamily: 'Source Serif 4, serif' } },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: sorted.map((l) => l.createdAt.slice(5, 10)), axisLabel: { color: '#6B6B78', fontSize: 9 } },
    yAxis: { type: 'value', name: 'ms', axisLabel: { color: '#6B6B78', fontSize: 10 } },
    color: ['#1E3A5F'],
    series: [{
      type: 'line', data: sorted.map((l) => l.latency),
      smooth: true, symbolSize: 6,
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(30,58,95,0.15)' }, { offset: 1, color: 'rgba(30,58,95,0)' }] } },
    }],
    grid: { top: 40, bottom: 30, left: 50, right: 20 },
  }
})
</script>

<template>
  <div class="admin-layout">
    <div class="stat-row">
      <StatCard label="文档总数" :value="stats?.docCount ?? docs.length" unit="份" />
      <StatCard label="文本切片" :value="(stats?.chunkCount ?? totalChunks).toLocaleString()" unit="片" />
      <StatCard label="图谱节点" :value="stats?.entityCount ?? entities.length" unit="个" />
      <StatCard label="问答次数" :value="stats?.qaCount ?? logs.length" unit="次" />
    </div>

    <!-- 服务状态 -->
    <div v-if="serviceStatus.server" class="svc-bar">
      <span class="svc-item" :class="serviceStatus.neo4j?.ok ? 'ok' : 'err'">Neo4j {{ serviceStatus.neo4j?.ok ? '✓' : '✗' }}</span>
      <span class="svc-item" :class="serviceStatus.flask?.ok ? 'ok' : 'err'">Flask {{ serviceStatus.flask?.ok ? '✓' : '✗' }}</span>
      <span class="svc-item ok">LLM ✓</span>
    </div>

    <div class="admin-header">
      <h2>后台管理</h2>
      <div class="header-actions">
        <input
          v-if="activeTab === 'docs'"
          ref="fileInput"
          type="file"
          accept=".pdf"
          class="file-input-hidden"
          @change="handleUpload"
        />
        <button v-if="activeTab === 'docs'" class="upload-btn" :disabled="uploading" @click="fileInput?.click()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
          {{ uploading ? '上传中...' : '上传文档' }}
        </button>
        <button v-if="activeTab === 'logs'" class="secondary-btn" :disabled="logs.length === 0" @click="exportLogs">导出 CSV</button>
        <button class="secondary-btn" :disabled="refreshing" @click="refreshAdminData(true)">
          {{ refreshing ? '刷新中...' : '刷新数据' }}
        </button>
      </div>
    </div>

    <div class="tabs">
      <button
        v-for="tab in [
          { id: 'docs', label: '文档管理' },
          { id: 'entities', label: '实体管理' },
          { id: 'config', label: '检索配置' },
          { id: 'logs', label: '问答日志' },
          { id: 'charts', label: '统计看板' }
        ]"
        :key="tab.id"
        class="tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >{{ tab.label }}</button>
    </div>

    <table v-if="activeTab === 'docs'" class="data-table">
      <thead><tr><th>文档标题</th><th>类型</th><th>状态</th><th>切片数</th><th>上传时间</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="doc in docs" :key="doc.docId">
          <td class="doc-title">{{ doc.title }}</td>
          <td>{{ doc.docType }}</td>
          <td><span class="status-tag" :class="statusTag(doc.status).class">{{ statusTag(doc.status).label }}</span></td>
          <td>{{ doc.chunkCount || '—' }}</td>
          <td>{{ doc.uploadedAt }}</td>
          <td><span class="action-link" @click="viewDoc(doc)">查看</span><span class="action-link danger" @click="deleteDocItem(doc)">删除</span></td>
        </tr>
      </tbody>
    </table>

    <table v-if="activeTab === 'entities'" class="data-table">
      <thead><tr><th>实体名称</th><th>类型</th><th>关系数</th><th>来源文档</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="e in entities" :key="e.entityId">
          <td class="doc-title">{{ e.name }}</td>
          <td>{{ e.type }}</td>
          <td>{{ e.relationCount }}</td>
          <td class="text-ellipsis">{{ e.sourceDoc }}</td>
          <td><span class="status-tag" :class="entityStatusTag(e.status).class">{{ entityStatusTag(e.status).label }}</span></td>
          <td>
            <span class="action-link" @click="viewEntity(e)">查看</span>
            <span class="action-link" @click="editEntity(e)">编辑</span>
            <button
              type="button"
              class="action-link danger"
              :disabled="isEntityDeleting(e.entityId)"
              @click.stop="deleteEntityItem(e)"
            >{{ isEntityDeleting(e.entityId) ? '删除中...' : '删除' }}</button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="activeTab === 'config'" class="config-panel">
      <div v-if="configLoadError" class="config-error-state">
        <strong>检索配置加载失败</strong>
        <span>{{ configLoadError }}</span>
        <button class="secondary-btn" @click="refreshAdminData()">重新加载</button>
      </div>

      <template v-else-if="config && configForm">
        <section class="config-section">
          <div class="config-section-heading">
            <h3>服务与索引状态</h3>
            <span>状态来自实时探测，不代表所有能力都已启用</span>
          </div>
          <div class="path-grid">
            <div v-for="item in config.capabilities" :key="item.key" class="path-card">
              <div class="path-header">
                <span class="path-label">{{ item.label }}</span>
                <span class="path-toggle" :class="{ on: item.available, warning: item.demo }">
                  {{ item.available ? (item.demo ? '演示数据' : '可用') : '不可用' }}
                </span>
              </div>
              <div v-if="item.details" class="path-weight">{{ item.details }}</div>
              <div v-if="item.source" class="path-source">数据源：{{ item.source }}</div>
              <p v-if="item.reason" class="path-reason">{{ item.reason }}</p>
            </div>
          </div>
        </section>

        <section class="config-section">
          <div class="config-section-heading">
            <h3>检索策略</h3>
            <span>权重合计 {{ totalRetrievalWeight.toFixed(2) }}，用于证据优先级，不要求等于 1</span>
          </div>

          <div class="strategy-list">
            <div class="strategy-row">
              <div class="strategy-copy">
                <div class="strategy-title">RAG 文档检索</div>
                <p>从已入库地质文献中提取 Top-K 片段。</p>
              </div>
              <el-switch
                v-model="configForm.ragEnabled"
                :disabled="!capability(configForm.ragMode)?.available && !configForm.ragEnabled"
                active-text="启用"
                inactive-text="停用"
              />
              <div class="mode-segment" aria-label="RAG 检索模式">
                <button
                  v-for="mode in (['bge', 'tfidf'] as const)"
                  :key="mode"
                  type="button"
                  :class="{ active: configForm.ragMode === mode }"
                  :disabled="!capability(mode)?.available"
                  @click="configForm.ragMode = mode"
                >{{ mode.toUpperCase() }}</button>
              </div>
              <label class="compact-field">
                <span>权重</span>
                <input v-model.number="configForm.ragWeight" type="number" min="0" max="1" step="0.05" />
                <small v-if="configErrors.ragWeight">{{ configErrors.ragWeight }}</small>
              </label>
              <label class="compact-field">
                <span>Top-K</span>
                <input v-model.number="configForm.ragTopK" type="number" min="1" max="20" />
                <small v-if="configErrors.ragTopK">{{ configErrors.ragTopK }}</small>
              </label>
            </div>

            <div class="strategy-row">
              <div class="strategy-copy">
                <div class="strategy-title">知识图谱检索</div>
                <p>查询 Neo4j 中的矿产、岩石、构造、年代和推理关系。</p>
              </div>
              <el-switch
                v-model="configForm.kgEnabled"
                :disabled="!capability('kg')?.available && !configForm.kgEnabled"
                active-text="启用"
                inactive-text="停用"
              />
              <label class="compact-field">
                <span>权重</span>
                <input v-model.number="configForm.kgWeight" type="number" min="0" max="1" step="0.05" />
                <small v-if="configErrors.kgWeight">{{ configErrors.kgWeight }}</small>
              </label>
            </div>

            <div class="strategy-row">
              <div class="strategy-copy">
                <div class="strategy-title">空间检索</div>
                <p>为地图和空间分析返回矿点、岩体与构造线；当前包含合成演示坐标。</p>
              </div>
              <el-switch
                v-model="configForm.spatialEnabled"
                :disabled="!capability('spatial')?.available && !configForm.spatialEnabled"
                active-text="启用"
                inactive-text="停用"
              />
              <label class="compact-field">
                <span>权重</span>
                <input v-model.number="configForm.spatialWeight" type="number" min="0" max="1" step="0.05" />
                <small v-if="configErrors.spatialWeight">{{ configErrors.spatialWeight }}</small>
              </label>
            </div>
          </div>
        </section>

        <section class="config-section">
          <div class="config-section-heading">
            <h3>生成参数</h3>
            <span>保存后应用于下一次 DeepSeek 调用</span>
          </div>
          <div class="param-grid">
            <div class="param-item">
              <label>模型</label>
              <select v-model="configForm.llmModel">
                <option value="deepseek-chat">deepseek-chat</option>
                <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                <option value="deepseek-v4-pro">deepseek-v4-pro</option>
              </select>
            </div>
            <div class="param-item">
              <label>最大 Token</label>
              <input v-model.number="configForm.maxTokens" type="number" min="256" max="8192" step="256" />
              <small v-if="configErrors.maxTokens">{{ configErrors.maxTokens }}</small>
            </div>
            <div class="param-item">
              <label>Temperature</label>
              <input v-model.number="configForm.temperature" type="number" min="0" max="1" step="0.1" />
              <small v-if="configErrors.temperature">{{ configErrors.temperature }}</small>
            </div>
          </div>
        </section>

        <section class="config-section">
          <div class="config-section-heading">
            <h3>离线增强能力</h3>
            <span>产物存在不等于每次问答都会在线运行</span>
          </div>
          <div class="artifact-list">
            <div v-for="item in config.offlineArtifacts" :key="item.key" class="artifact-row">
              <span class="status-dot" :class="{ on: item.available }" />
              <div>
                <strong>{{ item.label }}</strong>
                <p>{{ item.reason }}</p>
              </div>
              <time>{{ item.updatedAt ? formatConfigTime(item.updatedAt) : '无产物' }}</time>
            </div>
          </div>
        </section>

        <div class="config-footer">
          <div>
            <strong>{{ config.loaded ? '当前问答进程已加载' : '尚未加载' }}</strong>
            <span>{{ formatConfigTime(configForm.updatedAt) }}<template v-if="configForm.updatedBy"> · {{ configForm.updatedBy }}</template></span>
          </div>
          <button class="upload-btn" :disabled="configSaving" @click="saveRuntimeConfig">
            {{ configSaving ? '保存中...' : '保存检索策略' }}
          </button>
        </div>
      </template>

      <div v-else class="config-loading">正在读取检索配置...</div>
    </div>

    <table v-if="activeTab === 'logs'" class="data-table">
      <thead><tr><th>问题</th><th>检索路径</th><th>RAG</th><th>KG</th><th>空间</th><th>本次权重</th><th>耗时</th><th>时间</th></tr></thead>
      <tbody>
        <tr v-for="log in logs" :key="log.id">
          <td class="text-ellipsis" style="max-width:240px">{{ log.question }}</td>
          <td><span v-for="p in log.pathUsed" :key="p" class="path-tag">{{ pathLabelMap[p] || p }}</span></td>
          <td>{{ log.hitDocs }} 份</td>
          <td>{{ log.kgCount || 0 }} 条</td>
          <td>{{ log.spatialCount || 0 }} 个</td>
          <td class="weight-snapshot">R {{ log.ragWeight ?? 0 }} · G {{ log.kgWeight ?? 0 }} · S {{ log.spatialWeight ?? 0 }}</td>
          <td>{{ log.latency }}<span class="unit">ms</span></td>
          <td>{{ log.createdAt }}</td>
        </tr>
      </tbody>
    </table>

    <!-- 统计看板 -->
    <div v-if="activeTab === 'charts'" class="charts-grid">
      <ChartPanel :option="docTypeChartOption" height="320px" />
      <ChartPanel :option="retrievalChartOption" height="320px" />
      <ChartPanel :option="qaTimeChartOption" height="320px" />
    </div>

    <!-- 文档详情弹窗 -->
    <Teleport to="body">
      <div v-if="docDetailVisible" class="doc-overlay" @click.self="docDetailVisible = false">
        <div class="doc-dialog">
          <div class="doc-detail-header">
            <span class="doc-detail-title">{{ docDetail?.title }}</span>
            <button class="doc-detail-close" @click="docDetailVisible = false">✕</button>
          </div>
          <div class="doc-detail-body">
            <div v-if="!docDetail?.chunks?.length" class="doc-detail-empty">暂无切片数据</div>
            <div v-for="(c, i) in docDetail?.chunks || []" :key="i" class="chunk-item">
              <div class="chunk-meta">第 {{ c.page }} 页 · 切片 #{{ c.chunkIndex }}</div>
              <div class="chunk-text">{{ c.text }}</div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 实体查看弹窗 -->
    <Teleport to="body">
      <div v-if="entityViewVisible" class="doc-overlay" @click.self="entityViewVisible = false">
        <div class="doc-dialog" style="width: 420px">
          <div class="doc-detail-header">
            <span class="doc-detail-title">实体详情</span>
            <button class="doc-detail-close" @click="entityViewVisible = false">✕</button>
          </div>
          <div class="doc-detail-body" v-if="entityView">
            <div class="detail-grid">
              <div class="detail-row"><span class="detail-label">名称</span><span class="detail-value">{{ entityView.name }}</span></div>
              <div class="detail-row"><span class="detail-label">类型</span><span class="detail-value type-badge-sm" :style="{ background: typeColor(entityView.type) }">{{ entityView.type }}</span></div>
              <div class="detail-row"><span class="detail-label">关系数</span><span class="detail-value">{{ entityView.relationCount ?? '—' }}</span></div>
              <div class="detail-row"><span class="detail-label">来源文档</span><span class="detail-value text-ellipsis">{{ entityView.sourceDoc || '—' }}</span></div>
              <div class="detail-row"><span class="detail-label">状态</span><span class="status-tag" :class="entityStatusTag(entityView.status).class">{{ entityStatusTag(entityView.status).label }}</span></div>
              <template v-if="entityView.description">
                <div class="detail-divider"></div>
                <div class="detail-row stack"><span class="detail-label">描述</span><span class="detail-value" style="white-space: pre-wrap">{{ entityView.description }}</span></div>
              </template>
            </div>
            <div class="edit-actions">
              <button class="rename-btn confirm" @click="entityViewVisible = false; entityView && editEntity({ entityId: entityView.entityId, name: entityView.name, type: entityView.type, relationCount: entityView.relationCount || 0, sourceDoc: entityView.sourceDoc || '', status: entityView.status || 'verified' })">编辑</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 实体编辑弹窗 -->
    <Teleport to="body">
      <div v-if="entityEditVisible" class="doc-overlay" @click.self="entityEditVisible = false">
        <div class="doc-dialog" style="width: 420px">
          <div class="doc-detail-header">
            <span class="doc-detail-title">编辑实体</span>
            <button class="doc-detail-close" @click="entityEditVisible = false">✕</button>
          </div>
          <div class="doc-detail-body" v-if="entityEdit">
            <div class="edit-field">
              <label>类型</label>
              <input disabled :value="entityEdit.type" class="edit-input" />
            </div>
            <div class="edit-field">
              <label>名称</label>
              <input v-model="entityEdit.name" class="edit-input" />
            </div>
            <div class="edit-field">
              <label>描述</label>
              <textarea v-model="entityEdit.description" class="edit-textarea" rows="4" placeholder="实体描述..."></textarea>
            </div>
            <div class="edit-field">
              <label>状态</label>
              <select v-model="entityEdit.status" class="edit-select">
                <option value="verified">已审核</option>
                <option value="pending">待审核</option>
              </select>
            </div>
            <div class="edit-actions">
              <button class="rename-btn cancel" @click="entityEditVisible = false">取消</button>
              <button class="rename-btn confirm" :disabled="entitySaving" @click="saveEntity">
                {{ entitySaving ? '保存中...' : '保存' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.admin-layout { display: flex; flex-direction: column; height: 100%; padding: 24px; gap: 20px; overflow-y: auto; }
/* 服务状态条 */
.svc-bar { display: flex; gap: 14px; margin-top: -16px; margin-bottom: -8px; }
.svc-item { font-size: 11px; font-weight: 500; }
.svc-item.ok { color: var(--color-success); }
.svc-item.err { color: var(--color-danger); }
.stat-row { display: flex; gap: 16px; }
.admin-header { display: flex; justify-content: space-between; align-items: center; }
.header-actions { display: flex; align-items: center; gap: 8px; }
.admin-header h2 { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-ink-900); letter-spacing: -0.02em; }

.upload-btn {
  padding: 8px 18px; background: var(--color-ink-900); color: #fff; border: none;
  border-radius: var(--radius-md); font-size: 12px; cursor: pointer; font-weight: 600;
  font-family: var(--font-body); letter-spacing: 0.06em; display: flex; align-items: center;
  gap: 6px; transition: background 0.2s;
}
.upload-btn:hover { background: var(--color-ink-700); }
.upload-btn svg { width: 14px; height: 14px; }
.file-input-hidden { display: none; }
.secondary-btn {
  padding: 8px 12px; background: var(--color-surface); color: var(--color-ink-700);
  border: 1px solid var(--color-ink-100); border-radius: var(--radius-md); font-size: 12px;
  cursor: pointer; font-family: var(--font-body); transition: background 0.2s, border-color 0.2s;
}
.secondary-btn:hover:not(:disabled) { background: var(--color-bg-subtle); border-color: var(--color-ink-300); }
.secondary-btn:disabled, .upload-btn:disabled { cursor: not-allowed; opacity: 0.65; }

.tabs { display: flex; border-bottom: 1px solid var(--color-ink-100); gap: 0; }
.tab {
  padding: 10px 20px; font-size: 13px; cursor: pointer; border: none; background: none;
  border-bottom: 2px solid transparent; margin-bottom: -1px; color: var(--color-ink-500);
  font-family: var(--font-body); font-weight: 500; transition: all 0.15s;
}
.tab:hover { color: var(--color-ink-700); }
.tab.active { color: var(--color-primary); border-bottom-color: var(--color-primary); }

.data-table { width: 100%; border-collapse: collapse; background: var(--color-surface); border: 1px solid var(--color-ink-100); }
.data-table th {
  background: var(--color-bg-subtle); padding: 10px 16px; text-align: left;
  font-size: 10px; font-weight: 600; color: var(--color-ink-500);
  text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid var(--color-ink-100);
}
.data-table td { padding: 12px 16px; font-size: 13px; border-bottom: 1px solid var(--color-ink-50); color: var(--color-ink-700); }
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: rgba(0,0,0,0.01); }

.doc-title { font-weight: 500; color: var(--color-ink-900); }
.text-ellipsis { max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.text-muted { color: var(--color-ink-300); }
.unit { color: var(--color-ink-500); font-size: 11px; margin-left: 2px; }

.status-tag { padding: 2px 10px; border-radius: var(--radius-md); font-size: 11px; font-weight: 500; }
.status-tag.done { background: var(--color-success-light); color: var(--color-success); }
.status-tag.processing { background: var(--color-warning-light); color: var(--color-warning); }
.status-tag.pending { background: var(--color-ink-50); color: var(--color-ink-500); }
.status-tag.failed { background: var(--color-danger-light); color: var(--color-danger); }

.action-link { color: var(--color-primary); cursor: pointer; font-size: 12px; margin-right: 12px; font-weight: 500; }
button.action-link { padding: 0; border: 0; background: transparent; font-family: var(--font-body); }
.action-link:disabled { opacity: 0.55; cursor: not-allowed; text-decoration: none; }
.action-link:hover { text-decoration: underline; }
.action-link.danger { color: var(--color-danger); }

/* 文档详情弹窗 */
.doc-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,0.2);
  display: flex; align-items: center; justify-content: center;
}
.doc-dialog {
  background: var(--color-surface); border: 1px solid var(--color-ink-100);
  border-radius: var(--radius-md); width: 680px; max-height: 80vh;
  display: flex; flex-direction: column; box-shadow: var(--shadow-md);
}
.doc-detail-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid var(--color-ink-100);
}
.doc-detail-title {
  font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink-900);
}
.doc-detail-close {
  width: 24px; height: 24px; border: none; background: none; cursor: pointer;
  font-size: 16px; color: var(--color-ink-300);
}
.doc-detail-body { padding: 16px 20px; overflow-y: auto; }
.doc-detail-empty { font-size: 13px; color: var(--color-ink-300); text-align: center; padding: 24px; }
.chunk-item {
  padding: 12px 0; border-bottom: 1px solid var(--color-ink-50);
}
.chunk-item:last-child { border-bottom: none; }
.chunk-meta {
  font-size: 10px; color: var(--color-ink-300); font-weight: 600;
  letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 4px;
}
.chunk-text { font-size: 13px; color: var(--color-ink-700); line-height: 1.7; }

/* 实体编辑表单 */
.edit-field { margin-bottom: 14px; }
.edit-field label {
  display: block; font-size: 10px; font-weight: 600; color: var(--color-ink-500);
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px;
}
.edit-input, .edit-textarea, .edit-select {
  width: 100%; padding: 8px 10px; border: 1px solid var(--color-ink-100);
  border-radius: var(--radius-md); font-size: 13px; font-family: var(--font-body);
  color: var(--color-ink-900); outline: none; background: var(--color-bg);
  transition: border-color 0.2s;
}
.edit-input:focus, .edit-textarea:focus, .edit-select:focus { border-color: var(--color-primary); }
.edit-textarea { resize: vertical; }
.edit-select { cursor: pointer; }
.edit-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }

/* 实体详情 */
.detail-grid { display: flex; flex-direction: column; }
.detail-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 0; border-bottom: 1px solid var(--color-ink-50);
}
.detail-row.stack { flex-direction: column; align-items: flex-start; gap: 4px; }
.detail-label {
  font-size: 10px; font-weight: 600; color: var(--color-ink-500);
  text-transform: uppercase; letter-spacing: 0.06em;
}
.detail-value { font-size: 13px; color: var(--color-ink-900); max-width: 260px; word-break: break-all; }
.detail-divider { height: 1px; background: var(--color-ink-100); margin: 8px 0; }
.type-badge-sm { display: inline-block; padding: 2px 8px; border-radius: var(--radius-md); color: #fff; font-size: 11px; font-weight: 500; }

.path-tag {
  display: inline-block; padding: 1px 8px; border-radius: var(--radius-md);
  font-size: 11px; background: var(--color-primary-ghost); color: var(--color-primary);
  margin-right: 4px; font-weight: 500;
}

.config-panel { display: flex; flex-direction: column; gap: 0; background: var(--color-surface); border: 1px solid var(--color-ink-100); }
.config-section { padding: 20px; border-bottom: 1px solid var(--color-ink-100); }
.config-section h3 { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink-900); margin: 0; }
.config-section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.config-section-heading span { color: var(--color-ink-500); font-size: 11px; line-height: 1.6; text-align: right; }

.path-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.path-card { background: var(--color-surface); border: 1px solid var(--color-ink-100); border-radius: var(--radius-md); padding: 14px 16px; }
.path-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.path-label { font-size: 13px; font-weight: 500; color: var(--color-ink-900); }
.path-toggle { font-size: 11px; padding: 2px 8px; border-radius: var(--radius-md); font-weight: 500; background: var(--color-ink-50); color: var(--color-ink-500); }
.path-toggle.on { background: var(--color-success-light); color: var(--color-success); }
.path-toggle.warning { background: var(--color-warning-light); color: var(--color-warning); }
.path-weight { font-size: 12px; color: var(--color-ink-500); }
.path-source { margin-top: 4px; font-size: 11px; color: var(--color-accent); }
.path-reason { margin: 8px 0 0; font-size: 11px; line-height: 1.55; color: var(--color-ink-500); }

.strategy-list { display: flex; flex-direction: column; }
.strategy-row {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) auto minmax(140px, auto) 110px 90px;
  align-items: center;
  gap: 16px;
  min-height: 76px;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-ink-50);
}
.weight-snapshot { white-space: nowrap; font-size: 11px !important; color: var(--color-ink-500) !important; }
.strategy-row:last-child { border-bottom: 0; }
.strategy-row:nth-child(n + 2) { grid-template-columns: minmax(240px, 1fr) auto 110px; }
.strategy-copy { min-width: 0; }
.strategy-title { font-size: 13px; font-weight: 600; color: var(--color-ink-900); }
.strategy-copy p { margin: 4px 0 0; color: var(--color-ink-500); font-size: 11px; line-height: 1.5; }
.mode-segment { display: grid; grid-template-columns: repeat(2, 1fr); border: 1px solid var(--color-ink-100); border-radius: var(--radius-md); overflow: hidden; }
.mode-segment button {
  min-width: 68px;
  padding: 7px 9px;
  border: 0;
  border-right: 1px solid var(--color-ink-100);
  background: var(--color-bg-subtle);
  color: var(--color-ink-500);
  font: 600 11px var(--font-body);
  cursor: pointer;
}
.mode-segment button:last-child { border-right: 0; }
.mode-segment button.active { background: var(--color-accent); color: #fff; }
.mode-segment button:disabled { cursor: not-allowed; opacity: 0.45; }
.compact-field { display: flex; flex-direction: column; gap: 4px; }
.compact-field span { color: var(--color-ink-500); font-size: 10px; font-weight: 600; }
.compact-field input { width: 100%; min-width: 0; padding: 7px 9px; border: 1px solid var(--color-ink-100); border-radius: var(--radius-md); background: var(--color-bg-subtle); color: var(--color-ink-700); font: 13px var(--font-body); }
.compact-field small, .param-item small { color: var(--color-danger); font-size: 10px; line-height: 1.4; }

.param-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.param-item { display: flex; flex-direction: column; gap: 6px; }
.param-item label { font-size: 11px; color: var(--color-ink-500); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.param-item input, .param-item select {
  padding: 8px 12px; border: 1px solid var(--color-ink-100); border-radius: var(--radius-md);
  font-size: 13px; background: var(--color-bg-subtle); color: var(--color-ink-700);
  font-family: var(--font-body); transition: border-color 0.2s;
}
.param-item input:disabled { opacity: 0.7; cursor: not-allowed; }
.artifact-list { display: flex; flex-direction: column; }
.artifact-row { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--color-ink-50); }
.artifact-row:last-child { border-bottom: 0; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-ink-300); }
.status-dot.on { background: var(--color-success); }
.artifact-row strong { display: block; font-size: 12px; color: var(--color-ink-900); }
.artifact-row p { margin: 3px 0 0; font-size: 11px; line-height: 1.5; color: var(--color-ink-500); }
.artifact-row time { font-size: 11px; color: var(--color-ink-500); white-space: nowrap; }
.config-footer { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 16px 20px; background: var(--color-bg-subtle); }
.config-footer strong { display: block; font-size: 12px; color: var(--color-ink-900); }
.config-footer span { display: block; margin-top: 3px; font-size: 11px; color: var(--color-ink-500); }
.config-loading, .config-error-state { padding: 36px 20px; text-align: center; color: var(--color-ink-500); font-size: 13px; }
.config-error-state { display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--color-danger); }
.config-error-state span { color: var(--color-ink-500); }

@media (max-width: 1050px) {
  .strategy-row, .strategy-row:nth-child(n + 2) { grid-template-columns: minmax(210px, 1fr) auto 110px; }
  .strategy-row:first-child .mode-segment { grid-column: 1 / 2; }
}

@media (max-width: 720px) {
  .config-section-heading { align-items: flex-start; flex-direction: column; }
  .config-section-heading span { text-align: left; }
  .strategy-row, .strategy-row:nth-child(n + 2) { grid-template-columns: 1fr 110px; gap: 10px; }
  .strategy-copy { grid-column: 1 / -1; }
  .strategy-row:first-child .mode-segment { grid-column: 1 / -1; }
  .config-footer { align-items: stretch; flex-direction: column; }
  .artifact-row { grid-template-columns: 10px minmax(0, 1fr); }
  .artifact-row time { grid-column: 2; }
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 20px;
  margin-top: 8px;
}
</style>
