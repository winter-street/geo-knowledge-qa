<script setup lang="ts">
import { computed } from 'vue'
import type { Message } from '@/types'
import SourceCard from './SourceCard.vue'
import KgMiniGraph from './KgMiniGraph.vue'
import { renderMarkdown } from '@/utils/markdown'
import { formatEvidenceEntities, owlTypeMeta, summarizeOwlEvidence } from '@/utils/owl'
import { summarizeKgProvenance } from '@/utils/kg-evidence'
import { mapPlanLabels } from '@/utils/map-plan'
import { formatClaimCitations } from '@/utils/citations'

const props = defineProps<{ message: Message; question?: string; isLast?: boolean }>()

const emit = defineEmits<{ 'open-map': [message: Message] }>()

// 该条消息携带的标注 / 断裂线数量（0 则不显示地图入口）
const geoCount = computed(() => {
  const sd = props.message.spatialData
  if (!sd) return 0
  return (sd.markers?.length ?? 0) + (sd.polylines?.length ?? 0)
})
const hasMapResult = computed(() => geoCount.value > 0)

const owlEvidence = computed(() => summarizeOwlEvidence(props.message.kgContext || []))
const owlEntityCount = computed(() => {
  const names = new Set(owlEvidence.value.flatMap((item) => item.entities))
  return names.size
})
const inferredRelationCount = computed(
  () => props.message.kgContext?.filter((path) => path.inferred).length || 0
)
const kgProvenance = computed(() => summarizeKgProvenance(props.message.kgContext || []))
const spatialSummary = computed(() => props.message.spatialAnalysis?.summary)
const temporalSummary = computed(() => props.message.spatialAnalysis?.temporal)
const regionSummaries = computed(() => props.message.spatialAnalysis?.regions || [])
const leadingRegion = computed(() => [...regionSummaries.value]
  .filter((region) => region.averageProspectivityScore !== undefined)
  .sort((left, right) => right.averageProspectivityScore! - left.averageProspectivityScore!)[0])
const dominantEra = computed(() => {
  const buckets = temporalSummary.value?.buckets || []
  return [...buckets].sort((left, right) => right.count - left.count)[0]
})
const spatialConditions = computed(() => {
  const parsed = props.message.spatialAnalysis?.interpretation
  if (!parsed) return []
  return [
    parsed.anchorName ? `参照「${parsed.anchorName}」` : '',
    parsed.radiusKm ? `${parsed.radiusKm} 千米范围` : '',
    ...parsed.mineralKinds,
    ...parsed.timePeriods,
    ...parsed.owlTypes.map((type) => owlTypeMeta(type).label),
  ].filter(Boolean)
})
const planLabels = computed(() => props.message.mapPlan ? mapPlanLabels(props.message.mapPlan) : [])
const agentTrace = computed(() => props.message.toolTrace || [])
const completedToolCount = computed(() => agentTrace.value.filter((item) => item.status === 'completed').length)
const claimCitations = computed(() => formatClaimCitations(props.message.citations))

const TOOL_LABELS = {
  search_documents: '文档检索',
  query_knowledge_graph: '图谱查询',
  spatial_query: '空间分析',
  get_entity_detail: '实体详情',
} as const

const STATUS_LABELS = {
  running: '执行中',
  completed: '已完成',
  failed: '已降级',
  timeout: '已超时',
} as const

function handleOpenMap() {
  if (hasMapResult.value) emit('open-map', props.message)
}
</script>

<template>
  <div class="msg" :class="message.role">
    <div class="avatar">
      <svg v-if="message.role === 'user'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
      </svg>
    </div>
    <div class="content">
      <div class="bubble" :class="message.role" v-html="renderMarkdown(message.content)" />
      <div v-if="claimCitations.length" class="claim-citations" aria-label="断言级引用">
        <span v-for="citation in claimCitations" :key="citation.id">
          <em>{{ citation.label }}</em>{{ citation.detail }}
        </span>
      </div>
      <section v-if="agentTrace.length" class="agent-timeline" aria-label="Agent 执行时间线">
        <header>
          <span>Agent 执行</span>
          <small>{{ completedToolCount }}/{{ agentTrace.length }}</small>
        </header>
        <div v-for="tool in agentTrace" :key="tool.id" class="agent-timeline-row">
          <i class="agent-status" :class="tool.status" aria-hidden="true" />
          <strong>{{ TOOL_LABELS[tool.toolName] }}</strong>
          <span>{{ STATUS_LABELS[tool.status] }}</span>
          <small>
            {{ tool.latencyMs ?? 0 }} ms · {{ tool.evidenceCount ?? 0 }} 条证据
          </small>
        </div>
      </section>
      <details v-if="message.sources?.length" class="evidence-details">
        <summary><span>参考来源</span><small>{{ message.sources.length }} 条</small></summary>
        <div class="evidence-details-body">
          <div class="sources-list">
            <SourceCard v-for="(s, i) in message.sources" :key="s.docId + '-' + s.page" :source="s" :index="i + 1" />
          </div>
        </div>
      </details>

      <details v-if="owlEvidence.length" class="evidence-details" aria-label="本体推理证据">
        <summary><span>本体推理</span><small>{{ owlEvidence.length }} 类 · {{ owlEntityCount }} 个实体</small></summary>
        <div class="evidence-details-body">
          <div class="owl-evidence-list">
            <div v-for="item in owlEvidence" :key="item.type" class="owl-evidence-row">
              <div class="owl-evidence-kind">
                <strong>{{ item.label }}</strong>
                <span>{{ item.description }}</span>
              </div>
              <div class="owl-evidence-entities">{{ formatEvidenceEntities(item.entities) }}</div>
            </div>
          </div>
          <div v-if="inferredRelationCount" class="owl-relation-note">
            另有 {{ inferredRelationCount }} 条关系由 OWL 规则推得
          </div>
        </div>
      </details>

      <div v-if="kgProvenance.hasMock" class="kg-demo-note" role="note">
        <strong>演示关系</strong>
        <span>{{ kgProvenance.mockCount }} 条演示知识关系，不作为实际勘查结论。</span>
      </div>

      <!-- 知识图谱关联：内嵌力导向图窗口，按关键词查询子图 -->
      <KgMiniGraph
        v-if="message.kgContext?.length"
        :kg-context="message.kgContext"
        :question="question"
        :auto-expand="isLast"
      />

      <details v-if="spatialSummary" class="evidence-details" aria-label="空间分析证据">
        <summary><span>空间分析</span><small>{{ spatialSummary.pointCount }} 个点 · {{ spatialSummary.lineCount }} 条线</small></summary>
        <div class="evidence-details-body">
          <div v-if="spatialConditions.length" class="spatial-conditions">
            <span v-for="condition in spatialConditions" :key="condition">{{ condition }}</span>
          </div>
          <div v-if="temporalSummary?.buckets.length" class="spatial-temporal">
            <span>年代证据</span>
            <strong>{{ temporalSummary.buckets.length }} 个时期</strong>
            <em v-if="dominantEra">{{ dominantEra.era }}最多（{{ dominantEra.count }}）</em>
          </div>
          <div v-if="regionSummaries.length > 1" class="spatial-regions">
            <span>区域对比</span>
            <strong>{{ regionSummaries.length }} 个区域</strong>
            <em v-if="leadingRegion">{{ leadingRegion.region }}均分最高（{{ leadingRegion.averageProspectivityScore }}）</em>
          </div>
          <div v-if="spatialSummary.nearestName" class="spatial-nearest">
            <span>最近结果</span>
            <strong>{{ spatialSummary.nearestName }}</strong>
            <em>{{ spatialSummary.nearestDistanceKm?.toFixed(2) }} km</em>
          </div>
          <div v-if="spatialSummary.topProspectivityName" class="spatial-prospectivity">
            <span>演示有利度最高</span>
            <strong>{{ spatialSummary.topProspectivityName }}</strong>
            <em>{{ spatialSummary.topProspectivityScore }} 分</em>
          </div>
          <p v-if="spatialSummary.mockCount" class="spatial-disclaimer">
            其中 {{ spatialSummary.mockCount }} 个为功能演示要素，不作为实际勘查依据。
          </p>
        </div>
      </details>

      <div v-if="hasMapResult" class="map-action">
        <button type="button" class="map-cta" @click="handleOpenMap">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <circle cx="10" cy="8" r="2.5" />
            <path d="M10 17s-5-4.5-5-9a5 5 0 1110 0c0 4.5-5 9-5 9z" />
          </svg>
          查看地图
        </button>
        <span>{{ geoCount }} 处标注</span>
        <small v-if="planLabels.length">{{ planLabels.join(' · ') }}</small>
      </div>
    </div>
  </div>
</template>

<style scoped>
.msg {
  display: flex;
  gap: 14px;
}

.msg.assistant {
  width: min(100%, 820px);
}

.msg.user {
  align-self: flex-end;
  flex-direction: row-reverse;
  max-width: 700px;
}

.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar svg {
  width: 14px;
  height: 14px;
  stroke-width: 1.5;
}

.msg.user .avatar {
  background: var(--color-ink-900);
}

.msg.user .avatar svg {
  stroke: #fff;
}

.msg.assistant .avatar {
  background: var(--color-ink-100);
}

.msg.assistant .avatar svg {
  stroke: var(--color-ink-500);
}

.content {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  width: 100%;
}

.bubble {
  font-size: 15px;
  line-height: 1.75;
  color: var(--color-ink-700);
  text-wrap: pretty;
}

.claim-citations {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 7px;
  color: var(--color-ink-500);
  font-size: 11px;
  line-height: 1.5;
}

.claim-citations span {
  white-space: nowrap;
}

.claim-citations em {
  margin-right: 3px;
  color: var(--color-primary);
  font-family: var(--font-display);
  font-style: italic;
}

.msg.user .bubble {
  background: var(--color-bg-subtle);
  padding: 14px 18px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-ink-100);
  color: var(--color-ink-900);
}

.bubble :deep(h4) {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--color-ink-900);
  margin-bottom: 12px;
  letter-spacing: 0;
}

.bubble :deep(p) {
  margin-bottom: 10px;
}

.bubble :deep(strong) {
  color: var(--color-ink-900);
  font-weight: 600;
}

.agent-timeline {
  margin-top: 12px;
  border-top: 1px solid var(--color-ink-100);
  color: var(--color-ink-500);
}

.agent-timeline header,
.agent-timeline-row {
  display: grid;
  grid-template-columns: 12px minmax(108px, 1fr) minmax(52px, auto) minmax(112px, auto);
  gap: 8px;
  align-items: center;
  min-height: 32px;
}

.agent-timeline header {
  grid-template-columns: 1fr auto;
  min-height: 36px;
  color: var(--color-ink-700);
  font-size: 12px;
  font-weight: 600;
}

.agent-timeline header small,
.agent-timeline-row small {
  color: var(--color-ink-300);
  font-size: 10px;
  font-weight: 400;
  text-align: right;
}

.agent-timeline-row {
  border-top: 1px solid var(--color-ink-50);
  font-size: 11px;
}

.agent-timeline-row strong {
  min-width: 0;
  color: var(--color-ink-700);
  font-size: 11px;
  font-weight: 600;
}

.agent-status {
  width: 7px;
  height: 7px;
  border: 1px solid var(--color-ink-300);
  border-radius: 50%;
}

.agent-status.completed {
  border-color: var(--color-primary);
  background: var(--color-primary);
}

.agent-status.failed,
.agent-status.timeout {
  border-color: #8A5A12;
  background: #8A5A12;
}

.evidence-details {
  margin-top: 12px;
  border-top: 1px solid var(--color-ink-100);
}

.evidence-details > summary {
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--color-ink-700);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}

.evidence-details > summary::-webkit-details-marker {
  display: none;
}

.evidence-details > summary small {
  color: var(--color-ink-300);
  font-size: 10px;
  font-weight: 400;
}

.evidence-details-body {
  padding: 0 0 10px;
}

.sources-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.owl-evidence-list {
  display: flex;
  flex-direction: column;
}

.owl-evidence-row {
  display: grid;
  grid-template-columns: minmax(138px, 0.75fr) minmax(0, 1.5fr);
  gap: 16px;
  align-items: baseline;
  padding: 8px 0;
  border-top: 1px solid var(--color-ink-50);
}

.owl-evidence-kind {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.owl-evidence-kind strong {
  color: var(--color-ink-900);
  font-size: 12px;
  font-weight: 600;
}

.owl-evidence-kind span {
  color: var(--color-ink-300);
  font-size: 10px;
}

.owl-evidence-entities {
  min-width: 0;
  color: var(--color-ink-500);
  font-size: 11px;
  line-height: 1.65;
  overflow-wrap: anywhere;
  text-wrap: pretty;
}

.owl-relation-note {
  padding: 7px 0 8px;
  color: var(--color-accent);
  font-size: 10px;
}

.kg-demo-note {
  display: flex;
  gap: 10px;
  align-items: baseline;
  margin-top: 10px;
  padding: 7px 10px;
  border-left: 3px solid var(--color-accent);
  background: var(--color-bg-subtle);
  color: var(--color-ink-500);
  font-size: 11px;
  line-height: 1.55;
}

.kg-demo-note strong {
  flex: 0 0 auto;
  color: var(--color-accent);
  font-size: 11px;
  font-weight: 600;
}

.kg-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.kg-tag {
  font-size: 11px;
  color: var(--color-ink-600);
  background: var(--color-bg-subtle);
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-ink-100);
  white-space: nowrap;
}

.map-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  font-family: var(--font-body);
  color: var(--color-accent);
  background: var(--color-accent-light);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s;
}

.map-cta:hover {
  border-color: var(--color-accent);
}

.map-cta svg {
  width: 13px;
  height: 13px;
}

.spatial-conditions { display: flex; flex-wrap: wrap; gap: 5px 12px; padding: 9px 0; color: var(--color-ink-500); font-size: 11px; }
.spatial-temporal { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: baseline; padding: 8px 0; border-top: 1px solid var(--color-ink-50); }
.spatial-temporal span { color: var(--color-ink-300); font-size: 10px; }
.spatial-temporal strong { min-width: 0; color: var(--color-ink-700); font-size: 11px; }
.spatial-temporal em { color: var(--color-accent); font-size: 10px; font-style: normal; white-space: nowrap; }
.spatial-regions { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: baseline; padding: 8px 0; border-top: 1px solid var(--color-ink-50); }
.spatial-regions span { color: var(--color-ink-300); font-size: 10px; }
.spatial-regions strong { min-width: 0; color: var(--color-ink-700); font-size: 11px; }
.spatial-regions em { color: var(--color-accent); font-size: 10px; font-style: normal; text-align: right; overflow-wrap: anywhere; }
.spatial-nearest { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: baseline; padding: 8px 0; border-top: 1px solid var(--color-ink-50); }
.spatial-nearest span { color: var(--color-ink-300); font-size: 10px; }
.spatial-nearest strong { min-width: 0; color: var(--color-ink-700); font-size: 11px; overflow-wrap: anywhere; }
.spatial-nearest em { color: var(--color-primary); font-size: 10px; font-style: normal; white-space: nowrap; }
.spatial-prospectivity { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: baseline; padding: 8px 0; border-top: 1px solid var(--color-ink-50); }
.spatial-prospectivity span { color: var(--color-ink-300); font-size: 10px; }
.spatial-prospectivity strong { min-width: 0; color: var(--color-ink-700); font-size: 11px; overflow-wrap: anywhere; }
.spatial-prospectivity em { color: var(--color-primary); font-size: 10px; font-style: normal; white-space: nowrap; }
.spatial-disclaimer { margin: 0; padding: 7px 0; color: #7A5810; font-size: 10px; line-height: 1.55; text-wrap: pretty; }

.map-action {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--color-ink-100);
  color: var(--color-ink-400);
  font-size: 11px;
}

.map-action small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .msg { max-width: 100%; }

  .owl-evidence-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .spatial-regions {
    grid-template-columns: 1fr;
    gap: 2px;
  }

  .spatial-regions em { text-align: left; }

  .agent-timeline-row {
    grid-template-columns: 12px minmax(0, 1fr) auto;
  }

  .agent-timeline-row small {
    grid-column: 2 / -1;
    text-align: left;
    padding-bottom: 7px;
  }
}
</style>
