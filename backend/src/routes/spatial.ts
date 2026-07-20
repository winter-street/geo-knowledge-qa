/**
 * 空间数据路由 — 地质矢量图层 + 空间-语义联合查询
 *
 * GET  /api/spatial/layers         → 可用图层列表
 * GET  /api/spatial/layer/:name    → 图层 GeoJSON 数据
 * POST /api/spatial/query          → 空间+语义联合查询
 *
 * 当前状态：/spatial/query 已支持按关键词、实体类型和外包范围查询
 * Neo4j 坐标或明确主题的演示数据；静态 GeoJSON 图层仍等待数据接入。
 */

import { Router, type Request, type Response } from 'express'
import type {
  GeoEntityType,
  SpatialData,
  SpatialFeature,
  SpatialLayer,
  SpatialQueryRequest,
  SpatialQueryResponse,
} from '../types/index.js'
import { analyzeSpatialQuery } from '../services/spatial.js'
import { MOCK_SPATIAL_STATS } from '../data/spatial-mock.js'
import { buildProspectivityGrid, prospectivityGridEntityTypes } from '../services/prospectivity-grid.js'

const router = Router()

// ============================================================
// TODO: C 同学产出 GeoJSON 后，改为从 Flask :5000 转发或直接读文件
// ============================================================

/** 图层注册表（硬编码，空间数据就绪后从 Flask 拉取或读目录） */
const LAYER_REGISTRY: SpatialLayer[] = [
  // { name: 'minerals', label: '矿产点位', featureCount: 0 },
  // { name: 'faults',    label: '断裂带',   featureCount: 0 },
  // { name: 'strata',    label: '岩层分布',  featureCount: 0 },
  // { name: 'work_area', label: '工作区范围', featureCount: 0 },
]

const GEO_ENTITY_TYPES = new Set<GeoEntityType>([
  'Mineral', 'Rock', 'Structure', 'TimePeriod', 'DepositType', 'Region',
])

function toEntityType(type: string): GeoEntityType {
  return GEO_ENTITY_TYPES.has(type as GeoEntityType)
    ? type as GeoEntityType
    : 'Region'
}

function toFeatures(data: SpatialData): SpatialFeature[] {
  const features: SpatialFeature[] = []

  for (const marker of data.markers) {
    const entityType = toEntityType(marker.type)
    features.push({
      type: 'Point',
      coordinates: [marker.lng, marker.lat],
      properties: {
        name: marker.name, entityType, description: marker.detail, id: marker.id,
        region: marker.region, mineralKind: marker.mineralKind, era: marker.era,
        depositType: marker.depositType, owlTypes: marker.owlTypes,
        isAnchor: marker.isAnchor, isMock: marker.isMock,
        evidence: marker.evidence, distanceKm: marker.distanceKm,
        nearestStructureKm: marker.nearestStructureKm,
        prospectivity: marker.prospectivity,
      },
    })
  }

  for (const line of data.polylines) {
    const entityType = toEntityType(line.type)
    features.push({
      type: 'LineString',
      coordinates: line.path,
      properties: {
        name: line.label || line.id, entityType, id: line.id,
        region: line.region, isMock: line.isMock,
        evidence: line.evidence, distanceKm: line.distanceKm,
      },
    })
  }

  return features
}

function parseBbox(value: unknown): [number, number, number, number] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== 4 || value.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    throw new Error('bbox 必须是 [minLng, minLat, maxLng, maxLat] 数组')
  }
  const bbox = value as [number, number, number, number]
  if (bbox[0] > bbox[2] || bbox[1] > bbox[3]) {
    throw new Error('bbox 的最小坐标不能大于最大坐标')
  }
  return bbox
}

function parseCenter(value: unknown): [number, number] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== 2 || value.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    throw new Error('center 必须是 [lng, lat] 数组')
  }
  return value as [number, number]
}

function parseRadiusKm(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1000) {
    throw new Error('radiusKm 必须是 0 到 1000 之间的数值')
  }
  return value
}

// ============================================================
// GET /api/spatial/layers
// ============================================================
router.get('/spatial/layers', (_req: Request, res: Response) => {
  res.json({ layers: LAYER_REGISTRY })
})

router.get('/spatial/stats', (_req: Request, res: Response) => {
  res.json({
    ...MOCK_SPATIAL_STATS,
    source: 'mock',
    disclaimer: '空间要素仅用于本科开发实习的功能演示，不作为实际勘查依据',
  })
})

// ============================================================
// GET /api/spatial/layer/:name
// ============================================================
router.get('/spatial/layer/:name', (req: Request, res: Response) => {
  const { name } = req.params

  const layer = LAYER_REGISTRY.find((l) => l.name === name)
  if (!layer) {
    res.status(404).json({ error: `未知图层: ${name}` })
    return
  }

  // TODO: 从 Flask :5000 获取 GeoJSON 或直接读 ml-service/data/{name}.geojson
  console.log(`[spatial] 图层请求: ${name}（空间数据尚未就绪）`)
  res.status(503).json({
    error: '空间数据尚未就绪',
    hint: '等待 C 同学完成地质图矢量化，产出 GeoJSON 文件后接入',
    layer: name,
  })
})

// ============================================================
// POST /api/spatial/query
// ============================================================
router.post('/spatial/query', async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as SpatialQueryRequest
    const { keyword = '', question, entityTypes } = body
    const bbox = parseBbox((req.body || {}).bbox)
    const center = parseCenter((req.body || {}).center)
    const radiusKm = parseRadiusKm((req.body || {}).radiusKm)
    const validTypes = entityTypes?.filter((type): type is GeoEntityType => GEO_ENTITY_TYPES.has(type))

    if (entityTypes?.length && validTypes?.length !== entityTypes.length) {
      res.status(400).json({ error: 'entityTypes 包含不支持的实体类型' })
      return
    }

    const result = await analyzeSpatialQuery({
      ...body,
      keyword: keyword.trim(),
      question: question?.trim(),
      entityTypes: validTypes,
      bbox,
      center,
      radiusKm,
    })
    const features = toFeatures(result.data)
    const response: SpatialQueryResponse = {
      features,
      total: features.length,
      source: result.source,
      analysis: result.analysis,
    }

    console.log(
      `[spatial] query text="${question || keyword}", source=${result.source}, features=${features.length}`
    )
    res.json(response)
  } catch (err) {
    const message = (err as Error).message
    const badRequest = message.startsWith('bbox') || message.startsWith('center') || message.startsWith('radiusKm')
    res.status(badRequest ? 400 : 500).json({ error: message || '空间查询失败' })
  }
})

router.post('/spatial/grid', async (req: Request, res: Response) => {
  try {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : ''
    const gridSizeKm = Number(req.body?.gridSizeKm)
    const minimumScore = req.body?.minimumScore === undefined ? 85 : Number(req.body.minimumScore)
    const bbox = parseBbox(req.body?.bbox)
    if (!question) {
      res.status(400).json({ error: 'question 不能为空' })
      return
    }
    if (![5, 10, 20].includes(gridSizeKm)) {
      res.status(400).json({ error: 'gridSizeKm 只能是 5、10 或 20' })
      return
    }
    if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 100) {
      res.status(400).json({ error: 'minimumScore 必须在 0 到 100 之间' })
      return
    }

    const spatial = await analyzeSpatialQuery({
      question,
      includeMock: true,
      entityTypes: [...prospectivityGridEntityTypes],
      bbox,
    })
    const result = buildProspectivityGrid(spatial.data, {
      gridSizeKm: gridSizeKm as 5 | 10 | 20,
      minimumScore,
      criteria: spatial.analysis.interpretation,
    })
    res.json({
      ...result,
      source: spatial.source,
      spatialData: spatial.data,
      analysis: spatial.analysis,
    })
  } catch (error) {
    const message = (error as Error).message || '网格预测失败'
    res.status(message.startsWith('GRID_LIMIT_EXCEEDED') || message.startsWith('bbox') ? 400 : 500).json({ error: message })
  }
})

export default router
