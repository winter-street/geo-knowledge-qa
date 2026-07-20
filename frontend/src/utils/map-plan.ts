import type {
  GeoEntityType,
  MapActionType,
  MapPlan,
  SpatialAnalysis,
  SpatialData,
} from '../types/index.js'
import { markerHasEra } from './spatial-temporal.js'

export type MapActionStatus = 'pending' | 'success' | 'skipped' | 'failed'

export interface MapActionResult {
  actionIndex: number
  type: MapActionType
  status: MapActionStatus
  message?: string
}

export interface SpatialTaskSnapshot {
  planId: string
  plan: MapPlan
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

const ACTION_LABELS: Record<MapActionType, string> = {
  query: '空间查询',
  'filter-region': '区域筛选',
  'filter-era': '年代筛选',
  'filter-entity': '实体筛选',
  'set-result-mode': '有利度排序',
  buffer: '缓冲分析',
  heatmap: '热力图',
  timeline: '时空演化',
  'compare-regions': '区域对比',
  'grid-prediction': '网格预测',
  'fit-bounds': '地图定位',
  'suggest-export': '导出准备',
}

export function createMessageMapPlan(messageId: string, question: string): MapPlan {
  return {
    id: `qa-${messageId}`,
    version: 1,
    title: '问答空间结果',
    autoExecute: true,
    openFullMap: false,
    actions: [
      { type: 'query', question: question.trim() || '查看问答空间结果' },
      { type: 'fit-bounds' },
    ],
    warnings: [],
  }
}

export function mapPlanLabels(plan: MapPlan): string[] {
  return plan.actions.map((action) => ACTION_LABELS[action.type])
}

export function requiresFullMap(plan: MapPlan): boolean {
  if (plan.openFullMap) return true
  const complex = new Set<MapActionType>(['heatmap', 'timeline', 'compare-regions', 'grid-prediction'])
  return plan.actions.some((action) => complex.has(action.type))
}

export function filterSpatialTaskData(snapshot: SpatialTaskSnapshot): SpatialData {
  const data = snapshot.data ?? { markers: [], polylines: [] }
  const markers = (data.markers || []).filter((marker) => {
    if (snapshot.selectedRegions.length && !snapshot.selectedRegions.includes(marker.region || '')) return false
    if (snapshot.selectedEras.length && !snapshot.selectedEras.some((era) => markerHasEra(marker, era))) return false
    if (snapshot.selectedEntityTypes.length && !snapshot.selectedEntityTypes.includes(marker.type as GeoEntityType)) return false
    if (snapshot.buffer) {
      const distance = snapshot.buffer.targetType === 'Structure'
        ? marker.nearestStructureKm
        : marker.distanceKm
      if (distance === undefined || distance > snapshot.buffer.radiusKm) return false
    }
    return true
  })
  const polylines = (data.polylines || []).filter((line) => {
    if (snapshot.selectedRegions.length && !snapshot.selectedRegions.includes(line.region || '')) return false
    if (snapshot.selectedEntityTypes.length && !snapshot.selectedEntityTypes.includes(line.type as GeoEntityType)) return false
    return true
  })
  return { markers, polylines }
}

export function toMapViewState(snapshot: SpatialTaskSnapshot): {
  selectedRegion: string | null
  selectedEra: string | null
  resultMode: 'query' | 'score'
  heatmapVisible: boolean
  timelineMode: 'all' | 'single' | 'play'
} {
  return {
    selectedRegion: snapshot.selectedRegions.length === 1 ? snapshot.selectedRegions[0]! : null,
    selectedEra: snapshot.selectedEras[0] ?? snapshot.timeline.era ?? null,
    resultMode: snapshot.resultMode,
    heatmapVisible: snapshot.heatmapEnabled,
    timelineMode: snapshot.timeline.mode,
  }
}

export function reduceMapPlan(
  plan: MapPlan,
  previous?: SpatialTaskSnapshot,
): SpatialTaskSnapshot {
  if (previous?.planId === plan.id) return previous

  const snapshot: SpatialTaskSnapshot = {
    planId: plan.id,
    plan,
    selectedRegions: [],
    selectedEras: [],
    selectedEntityTypes: [],
    resultMode: 'query',
    heatmapEnabled: false,
    timeline: { mode: 'all' },
    actionResults: plan.actions.map((action, actionIndex) => ({
      actionIndex,
      type: action.type,
      status: 'pending',
    })),
  }

  for (const action of plan.actions) {
    switch (action.type) {
      case 'filter-region':
      case 'compare-regions':
        snapshot.selectedRegions = [...action.regions]
        break
      case 'filter-era':
        snapshot.selectedEras = [...action.eras]
        break
      case 'filter-entity':
        snapshot.selectedEntityTypes = [...action.entityTypes]
        break
      case 'set-result-mode':
        snapshot.resultMode = action.mode
        break
      case 'buffer':
        snapshot.buffer = {
          radiusKm: action.radiusKm,
          ...(action.anchorName ? { anchorName: action.anchorName } : {}),
          ...(action.targetType ? { targetType: action.targetType } : {}),
        }
        break
      case 'heatmap':
        snapshot.heatmapEnabled = action.enabled
        break
      case 'timeline':
        snapshot.timeline = { mode: action.mode, ...(action.era ? { era: action.era } : {}) }
        break
      case 'grid-prediction':
        snapshot.grid = {
          gridSizeKm: action.gridSizeKm,
          minimumScore: action.minimumScore ?? 85,
        }
        break
      case 'suggest-export':
        snapshot.exportSuggestion = action.format
        break
      default:
        break
    }
  }

  return snapshot
}
