<script setup lang="ts">
import { computed } from 'vue'
import { Close, TrendCharts } from '@element-plus/icons-vue'
import type {
  ProspectivityGridCell,
  ProspectivityGridResult,
  ProspectivityTarget,
} from '@/types'
import { gridCellColor, gridTargetSummary } from '@/utils/prospectivity-grid'

const props = defineProps<{
  query: string
  gridSizeKm: 5 | 10 | 20
  minimumScore: number
  loading: boolean
  result: ProspectivityGridResult | null
  selectedCell: ProspectivityGridCell | null
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  'update:gridSizeKm': [value: 5 | 10 | 20]
  'update:minimumScore': [value: number]
  run: []
  close: []
  selectTarget: [target: ProspectivityTarget]
}>()

const rankedTargets = computed(() => [...(props.result?.targets || [])]
  .sort((left, right) => right.averageScore - left.averageScore))

function setThreshold(event: Event) {
  emit('update:minimumScore', Number((event.target as HTMLInputElement).value))
}

function factorWidth(score: number, maxScore: number): string {
  return `${Math.max(0, Math.min(100, maxScore ? score / maxScore * 100 : 0))}%`
}
</script>

<template>
  <div class="prospectivity-panel">
    <header class="panel-head">
      <div>
        <span>空间分析</span>
        <h2>靶区预测</h2>
      </div>
      <button class="icon-button" title="关闭靶区预测面板" aria-label="关闭靶区预测面板" @click="emit('close')">
        <Close aria-hidden="true" />
      </button>
    </header>

    <section class="prediction-controls" aria-label="预测参数">
      <label class="query-field">
        <span>区域与地质条件</span>
        <input
          :value="query"
          placeholder="例如：攀枝花 钒钛磁铁矿"
          @input="emit('update:query', ($event.target as HTMLInputElement).value)"
          @keydown.enter="emit('run')"
        />
      </label>

      <div class="control-label">网格尺寸</div>
      <div class="segmented" aria-label="网格尺寸">
        <button
          v-for="size in ([5, 10, 20] as const)"
          :key="size"
          :class="{ active: gridSizeKm === size }"
          @click="emit('update:gridSizeKm', size)"
        >{{ size }} km</button>
      </div>

      <div class="threshold-head">
        <span>靶区阈值</span>
        <output>{{ minimumScore }} 分</output>
      </div>
      <input class="threshold-slider" type="range" min="65" max="95" step="1" :value="minimumScore" @input="setThreshold" />

      <button class="run-button" :disabled="loading || !query.trim()" @click="emit('run')">
        <TrendCharts aria-hidden="true" />
        {{ loading ? '正在计算' : '开始预测' }}
      </button>
    </section>

    <template v-if="result">
      <section class="prediction-summary" aria-label="预测汇总">
        <div><strong>{{ result.summary.cellCount }}</strong><span>有效网格</span></div>
        <div><strong>{{ result.summary.highCount }}</strong><span>高分网格</span></div>
        <div><strong>{{ result.summary.targetCount }}</strong><span>预测靶区</span></div>
      </section>

      <section v-if="selectedCell" class="factor-section" aria-label="四维动态评分">
        <header class="score-head">
          <div>
            <span>{{ selectedCell.id }}</span>
            <h3>四维动态评分</h3>
          </div>
          <strong :style="{ color: gridCellColor(selectedCell.score) }">{{ selectedCell.score }}</strong>
        </header>

        <div class="factor-list">
          <div v-for="factor in selectedCell.factors" :key="factor.key" class="factor-row" :class="factor.key">
            <div class="factor-meta">
              <span>{{ factor.label }}</span>
              <strong>{{ factor.score }} / {{ factor.maxScore }}</strong>
            </div>
            <div class="factor-track"><i :style="{ width: factorWidth(factor.score, factor.maxScore) }" /></div>
            <p>{{ factor.evidence }}</p>
          </div>
        </div>
      </section>

      <section class="target-section" aria-label="靶区聚合结果">
        <div class="aggregation-note">
          <span>靶区聚合</span>
          <strong>高分网格连通 → 合并多边形边界 → 形成预测靶区</strong>
        </div>
        <div v-if="rankedTargets.length" class="target-list">
          <button
            v-for="(target, index) in rankedTargets"
            :key="target.id"
            :title="gridTargetSummary(target)"
            @click="emit('selectTarget', target)"
          >
            <span>{{ String(index + 1).padStart(2, '0') }}</span>
            <div><strong>{{ target.name }}</strong><small>{{ target.areaKm2 }} km² · {{ target.cellCount }} 格</small></div>
            <em>{{ target.averageScore }}</em>
          </button>
        </div>
        <p v-else class="empty-target">当前阈值下没有形成连续高分靶区。</p>
      </section>

      <footer class="disclaimer">{{ result.disclaimer }}</footer>
    </template>

    <div v-else class="empty-state">
      <strong>等待预测</strong>
      <span>当前地图范围</span>
    </div>
  </div>
</template>

<style scoped>
.prospectivity-panel { display: flex; flex-direction: column; min-height: 100%; }
.panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px 13px; border-bottom: 1px solid var(--color-ink-100); }
.panel-head span, .control-label, .query-field > span, .threshold-head > span { color: var(--color-primary); font-size: 10px; font-weight: 600; }
.panel-head h2 { margin: 2px 0 0; color: var(--color-ink-900); font-family: var(--font-display); font-size: 19px; font-weight: 600; letter-spacing: 0; }
.icon-button { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid transparent; background: transparent; color: var(--color-ink-500); cursor: pointer; }
.icon-button svg { width: 17px; height: 17px; }
.icon-button:hover, .icon-button:focus-visible { border-color: var(--color-ink-100); color: var(--color-ink-900); outline: none; }

.prediction-controls { padding: 14px 18px 16px; border-bottom: 1px solid var(--color-ink-100); }
.query-field { display: flex; flex-direction: column; gap: 6px; }
.query-field input { width: 100%; height: 36px; padding: 0 10px; border: 1px solid var(--color-ink-100); border-radius: var(--radius-md); background: var(--color-bg); color: var(--color-ink-900); font: 12px var(--font-body); outline: none; }
.query-field input:focus { border-color: var(--color-primary); }
.control-label { margin-top: 13px; }
.segmented { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 6px; border: 1px solid var(--color-ink-100); }
.segmented button { min-height: 31px; border: 0; border-left: 1px solid var(--color-ink-100); background: var(--color-surface); color: var(--color-ink-500); font: 11px var(--font-body); cursor: pointer; }
.segmented button:first-child { border-left: 0; }
.segmented button:hover { color: var(--color-primary); }
.segmented button.active { background: var(--color-primary-light); color: var(--color-primary); font-weight: 600; }
.threshold-head { display: flex; align-items: center; justify-content: space-between; margin-top: 13px; }
.threshold-head output { color: var(--color-ink-900); font-family: var(--font-display); font-size: 13px; font-weight: 600; }
.threshold-slider { width: 100%; margin: 7px 0 4px; accent-color: var(--color-primary); }
.run-button { display: flex; align-items: center; justify-content: center; gap: 7px; width: 100%; min-height: 36px; margin-top: 9px; border: 1px solid var(--color-ink-900); border-radius: var(--radius-md); background: var(--color-ink-900); color: #fff; font: 600 12px var(--font-body); cursor: pointer; }
.run-button svg { width: 15px; height: 15px; }
.run-button:hover:not(:disabled) { background: var(--color-ink-700); }
.run-button:disabled { opacity: 0.45; cursor: not-allowed; }

.prediction-summary { display: grid; grid-template-columns: repeat(3, 1fr); padding: 12px 18px; border-bottom: 1px solid var(--color-ink-100); }
.prediction-summary div { display: flex; flex-direction: column; gap: 2px; padding-left: 10px; border-left: 1px solid var(--color-ink-100); }
.prediction-summary div:first-child { padding-left: 0; border-left: 0; }
.prediction-summary strong { color: var(--color-ink-900); font-family: var(--font-display); font-size: 20px; }
.prediction-summary span { color: var(--color-ink-300); font-size: 9px; }

.factor-section { padding: 15px 18px 12px; border-bottom: 1px solid var(--color-ink-100); }
.score-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.score-head span { color: var(--color-ink-300); font-size: 9px; }
.score-head h3 { margin: 2px 0 0; color: var(--color-ink-900); font-family: var(--font-display); font-size: 16px; font-weight: 600; letter-spacing: 0; }
.score-head > strong { font-family: var(--font-display); font-size: 30px; line-height: 1; }
.factor-list { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; }
.factor-meta { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.factor-meta span { color: var(--color-ink-700); font-size: 12px; }
.factor-meta strong { color: var(--color-ink-900); font-family: var(--font-display); font-size: 12px; }
.factor-track { height: 7px; margin-top: 5px; background: var(--color-ink-50); overflow: hidden; }
.factor-track i { display: block; height: 100%; background: var(--color-primary); transition: width 180ms ease; }
.factor-row.density .factor-track i { background: var(--color-warning); }
.factor-row.ontology .factor-track i { background: var(--color-accent); }
.factor-row.geology .factor-track i { background: var(--color-ink-500); }
.factor-row p { margin: 4px 0 0; color: var(--color-ink-300); font-size: 9px; line-height: 1.5; overflow-wrap: anywhere; }

.target-section { padding: 13px 18px; }
.aggregation-note { padding: 10px 11px; border-top: 2px solid var(--color-primary); background: var(--color-primary-light); }
.aggregation-note span { display: block; color: var(--color-primary); font-size: 10px; font-weight: 600; }
.aggregation-note strong { display: block; margin-top: 3px; color: var(--color-ink-700); font-size: 11px; font-weight: 500; line-height: 1.5; }
.target-list { display: flex; flex-direction: column; margin-top: 9px; }
.target-list button { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 8px; align-items: center; width: 100%; padding: 9px 3px; border: 0; border-bottom: 1px solid var(--color-ink-50); background: transparent; color: var(--color-ink-300); text-align: left; cursor: pointer; }
.target-list button:hover, .target-list button:focus-visible { background: var(--color-danger-light); outline: none; }
.target-list div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.target-list strong { color: var(--color-ink-700); font-size: 11px; }
.target-list small { color: var(--color-ink-300); font-size: 9px; }
.target-list em { color: var(--color-danger); font-family: var(--font-display); font-size: 17px; font-style: normal; }
.empty-target { margin: 10px 0 0; color: var(--color-ink-300); font-size: 10px; }
.disclaimer { margin: auto 18px 14px; padding-top: 10px; border-top: 1px solid var(--color-warning); color: #7A5810; font-size: 9px; line-height: 1.5; }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 180px; color: var(--color-ink-300); }
.empty-state strong { color: var(--color-ink-700); font-family: var(--font-display); font-size: 15px; }
.empty-state span { margin-top: 3px; font-size: 10px; }
</style>
