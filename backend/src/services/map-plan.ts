import { createHash } from 'node:crypto'
import type {
  GeoEntityType,
  MapAction,
  MapPlan,
  SpatialAnalysis,
} from '../types/index.js'
import { parseSpatialQuestion } from './spatial-query.js'

const VALID_GRID_SIZES = new Set([5, 10, 20])

function parseGridSize(question: string): { size: 5 | 10 | 20; warning?: string } {
  const match = question.match(/(\d+(?:\.\d+)?)\s*(?:公里|千米|km|KM)\s*网格|网格[^\d]{0,6}(\d+(?:\.\d+)?)\s*(?:公里|千米|km|KM)/)
  const value = Number(match?.[1] || match?.[2] || 10)
  if (VALID_GRID_SIZES.has(value)) return { size: value as 5 | 10 | 20 }
  return { size: 10, warning: `网格大小 ${value} km 不受支持，已使用 10 km` }
}

function explicitEntityFilter(question: string): GeoEntityType[] {
  if (!/(只看|仅看|筛选|过滤)/.test(question)) return []
  const types: GeoEntityType[] = []
  if (/(矿点|矿产|矿床)/.test(question)) types.push('Mineral')
  if (/(岩石|岩体)/.test(question)) types.push('Rock')
  if (/(断裂|构造|断层)/.test(question)) types.push('Structure')
  return types
}

export function buildMapPlan(
  question: string,
  analysis?: SpatialAnalysis,
): MapPlan | undefined {
  const text = String(question || '').trim()
  if (!text) return undefined
  const parsed = parseSpatialQuestion(text)
  const interpretation = analysis?.interpretation
    ? {
        ...parsed,
        ...analysis.interpretation,
        anchorName: analysis.interpretation.anchorName ?? parsed.anchorName,
        radiusKm: analysis.interpretation.radiusKm ?? parsed.radiusKm,
      }
    : parsed
  const extraSpatialIntent = /(热力|密集区|聚集区|网格|靶区|导出|下载|打开地图|进入地图)/.test(text)
  if (!interpretation.spatialIntent && !extraSpatialIntent) return undefined

  const actions: MapAction[] = [{ type: 'query', question: text }]
  const warnings: string[] = []
  const gridIntent = /(网格|靶区)/.test(text)
  const regions = (analysis?.regions || []).map((item) => item.region).filter(Boolean)
  if (regions.length) actions.push({ type: 'filter-region', regions })
  if (interpretation.timePeriods.length) {
    actions.push({ type: 'filter-era', eras: interpretation.timePeriods })
  }
  const entityTypes = explicitEntityFilter(text)
  if (entityTypes.length) actions.push({ type: 'filter-entity', entityTypes })

  const scoreIntent = interpretation.sortBy === 'score' || /(高有利|有利点|高分)/.test(text)
  if (scoreIntent) actions.push({ type: 'set-result-mode', mode: 'score' })

  const explicitBufferIntent = /(范围内|以内|附近|周边|方圆|缓冲区|距离)/.test(text)
  if (interpretation.radiusKm && (!gridIntent || explicitBufferIntent)) {
    actions.push({
      type: 'buffer',
      radiusKm: Math.min(1000, Math.max(0.1, interpretation.radiusKm)),
      ...(interpretation.anchorName ? { anchorName: interpretation.anchorName } : {}),
      ...(/(断裂|构造|断层)/.test(text) ? { targetType: 'Structure' as const } : {}),
    })
  }

  if (/(热力|密集区|聚集区)/.test(text)) actions.push({ type: 'heatmap', enabled: true })

  if (/(时空|演化|时间轴|年代序列|时期变化)/.test(text)) {
    const era = interpretation.timePeriods[0]
    const mode = /(播放|演示|动态)/.test(text) ? 'play' : era ? 'single' : 'all'
    actions.push({ type: 'timeline', mode, ...(era ? { era } : {}) })
  }

  if (regions.length > 1 && /(对比|比较|差异)/.test(text)) {
    actions.push({ type: 'compare-regions', regions })
  }

  if (gridIntent) {
    const grid = parseGridSize(text)
    if (grid.warning) warnings.push(grid.warning)
    actions.push({ type: 'grid-prediction', gridSizeKm: grid.size, minimumScore: 85 })
  }

  actions.push({ type: 'fit-bounds' })

  if (/(导出|下载)/.test(text)) {
    actions.push({
      type: 'suggest-export',
      format: /csv/i.test(text) ? 'csv' : 'geojson',
    })
  }

  const explicitMapIntent = /(打开地图|进入地图|完整地图)/.test(text)
  const titleSubject = interpretation.mineralKinds[0] || regions[0] || '地质要素'
  const id = createHash('sha1')
    .update(`${text}:${JSON.stringify(actions)}`)
    .digest('hex')
    .slice(0, 12)

  return {
    id,
    version: 1,
    title: `${titleSubject}空间分析`,
    autoExecute: true,
    openFullMap: explicitMapIntent,
    actions,
    warnings,
  }
}
