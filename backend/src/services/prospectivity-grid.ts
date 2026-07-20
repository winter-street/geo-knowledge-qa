import {
  area,
  bbox,
  booleanPointInPolygon,
  centroid,
  distance,
  featureCollection,
  lineString,
  point,
  pointToLineDistance,
  polygon,
  squareGrid,
  union,
} from '@turf/turf'
import type {
  GeoEntityType,
  GeoPoint,
  ProspectivityGridCell,
  ProspectivityGridFactor,
  ProspectivityGridResult,
  ProspectivityTarget,
  SpatialData,
  SpatialQueryInterpretation,
} from '../types/index.js'

export const prospectivityGridEntityTypes = ['Mineral', 'Rock', 'Structure'] as const satisfies readonly GeoEntityType[]

export interface ProspectivityGridOptions {
  gridSizeKm: 5 | 10 | 20
  minimumScore?: number
  maxCells?: number
  criteria?: Pick<SpatialQueryInterpretation, 'mineralKinds' | 'timePeriods' | 'depositTypes'>
}

interface InternalCell extends ProspectivityGridCell {
  markerIds: string[]
}

const DISCLAIMER = '网格有利度与靶区基于合成坐标和 demo-v1 规则模型，仅用于本科开发实习功能演示，不作为实际勘查依据'

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function dominant(values: Array<string | undefined>): string | undefined {
  const counts = new Map<string, number>()
  for (const value of values) {
    if (value) counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0]
}

function levelFor(score: number): 'high' | 'medium' | 'low' {
  return score >= 85 ? 'high' : score >= 65 ? 'medium' : 'low'
}

interface MatchResult {
  score: number
  matched: number
  total: number
}

function valuesMatch(values: string[], requested: string[]): boolean {
  return values.some((value) => requested.some((term) => value.includes(term) || term.includes(value)))
}

function conditionMatch(
  candidates: string[][],
  requested: string[],
): MatchResult {
  const available = candidates.filter((values) => values.length > 0)
  if (!available.length) return { score: 0, matched: 0, total: 0 }
  if (!requested.length) return { score: 5, matched: available.length, total: available.length }
  const matched = available.filter((values) => valuesMatch(values, requested)).length
  return {
    score: round(5 * matched / available.length),
    matched,
    total: available.length,
  }
}

function geologyFactor(
  nearby: GeoPoint[],
  criteria?: ProspectivityGridOptions['criteria'],
): ProspectivityGridFactor {
  const mineral = conditionMatch(
    nearby
      .filter((marker) => marker.type === 'Mineral')
      .map((marker) => [marker.mineralKind, marker.name].filter((value): value is string => Boolean(value))),
    criteria?.mineralKinds || [],
  )
  const era = conditionMatch(
    nearby.map((marker) => marker.era ? [marker.era] : []),
    criteria?.timePeriods || [],
  )
  const deposit = conditionMatch(
    nearby.map((marker) => marker.depositType ? [marker.depositType] : []),
    criteria?.depositTypes || [],
  )
  const hasRequestedConditions = Boolean(
    criteria?.mineralKinds.length || criteria?.timePeriods.length || criteria?.depositTypes.length,
  )
  const evidence = hasRequestedConditions
    ? `矿种匹配 ${mineral.matched}/${mineral.total}，年代匹配 ${era.matched}/${era.total}，成因匹配 ${deposit.matched}/${deposit.total}`
    : `未限定地质条件，按格内矿种、年代和成因字段覆盖度计分`

  return {
    key: 'geology',
    label: '地质条件匹配',
    score: round(mineral.score + era.score + deposit.score),
    maxScore: 15,
    evidence,
  }
}

function emptyResult(options: ProspectivityGridOptions, warning: string): ProspectivityGridResult {
  return {
    gridSizeKm: options.gridSizeKm,
    minimumScore: options.minimumScore ?? 85,
    cells: [],
    targets: [],
    summary: { cellCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, targetCount: 0, maxScore: 0 },
    warnings: [warning, DISCLAIMER],
    demo: true,
    disclaimer: DISCLAIMER,
  }
}

function scoreCell(
  centerCoord: [number, number],
  nearby: GeoPoint[],
  structureDistanceKm: number | undefined,
  criteria?: ProspectivityGridOptions['criteria'],
): ProspectivityGridFactor[] {
  const structureScore = structureDistanceKm === undefined
    ? 0
    : round(Math.max(0, 40 - structureDistanceKm * 2.5))
  const densityScore = round(Math.min(25, nearby.length * 2.5))
  const ontologyEvidence = nearby.filter((marker) => (marker.owlTypes?.length || 0) > 0 || Boolean(marker.evidence)).length
  const ontologyScore = round(Math.min(20, ontologyEvidence * 4))
  return [
    {
      key: 'structure', label: '构造邻近度', score: structureScore, maxScore: 40,
      evidence: structureDistanceKm === undefined
        ? '当前范围没有构造线证据'
        : `网格中心距最近构造约 ${round(structureDistanceKm, 2)} km`,
    },
    {
      key: 'density', label: '矿化点密度', score: densityScore, maxScore: 25,
      evidence: `${round(centerCoord[0], 2)}, ${round(centerCoord[1], 2)} 周边命中 ${nearby.length} 个点`,
    },
    {
      key: 'ontology', label: 'OWL/KG 证据', score: ontologyScore, maxScore: 20,
      evidence: `${ontologyEvidence} 个点带有知识图谱或本体证据`,
    },
    geologyFactor(nearby, criteria),
  ]
}

function connectedTargets(
  cells: InternalCell[],
  markers: GeoPoint[],
  gridSizeKm: number,
  minimumScore: number,
): ProspectivityTarget[] {
  const highCells = cells.filter((cell) => cell.score >= minimumScore)
  const remaining = new Set(highCells.map((_, index) => index))
  const groups: InternalCell[][] = []

  while (remaining.size) {
    const start = remaining.values().next().value as number
    remaining.delete(start)
    const queue = [start]
    const group: InternalCell[] = []
    while (queue.length) {
      const currentIndex = queue.shift()!
      const current = highCells[currentIndex]!
      group.push(current)
      for (const candidateIndex of [...remaining]) {
        const candidate = highCells[candidateIndex]!
        const gap = distance(point(current.center), point(candidate.center), { units: 'kilometers' })
        if (gap <= gridSizeKm * 1.2) {
          remaining.delete(candidateIndex)
          queue.push(candidateIndex)
        }
      }
    }
    groups.push(group)
  }

  const ordered = groups.sort((left, right) => {
    const leftAverage = left.reduce((sum, cell) => sum + cell.score, 0) / left.length
    const rightAverage = right.reduce((sum, cell) => sum + cell.score, 0) / right.length
    return rightAverage - leftAverage
  })

  return ordered.map((group, index) => {
    const markerIds = new Set(group.flatMap((cell) => cell.markerIds))
    const targetMarkers = markers.filter((marker) => markerIds.has(marker.id))
    const scores = group.map((cell) => cell.score)
    const merged = union(featureCollection(group.map((cell) => polygon(cell.coordinates))))
    const coordinates = merged?.geometry.type === 'Polygon'
      ? [merged.geometry.coordinates as Array<Array<[number, number]>>]
      : merged?.geometry.coordinates as Array<Array<Array<[number, number]>>> | undefined
    return {
      id: `target-${index + 1}`,
      name: `预测靶区 ${String.fromCharCode(65 + index)}`,
      coordinates: coordinates ?? group.map((cell) => cell.coordinates),
      cellCount: group.length,
      areaKm2: round(group.reduce((sum, cell) => sum + area(polygon(cell.coordinates)) / 1_000_000, 0), 2),
      averageScore: round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
      maxScore: Math.max(...scores),
      pointCount: targetMarkers.length,
      minimumScore,
      dominantMineralKind: dominant(targetMarkers.map((marker) => marker.mineralKind)),
      dominantEra: dominant(targetMarkers.map((marker) => marker.era)),
      demo: true,
    }
  })
}

export function buildProspectivityGrid(
  data: SpatialData,
  options: ProspectivityGridOptions,
): ProspectivityGridResult {
  const markers = data.markers || []
  const lines = (data.polylines || []).filter((line) => line.path.length >= 2)
  if (!markers.length && !lines.length) return emptyResult(options, '当前查询没有可用于网格预测的空间数据')

  const inputFeatures = [
    ...markers.map((marker) => point([marker.lng, marker.lat])),
    ...lines.map((line) => lineString(line.path)),
  ]
  const bounds = bbox(featureCollection(inputFeatures as any)) as [number, number, number, number]
  const grid = squareGrid(bounds, options.gridSizeKm, { units: 'kilometers' })
  const maxCells = options.maxCells ?? 5000
  if (grid.features.length > maxCells) {
    throw new Error(`GRID_LIMIT_EXCEEDED: 网格数量 ${grid.features.length} 超过上限 ${maxCells}，请增大网格尺寸或缩小区域`)
  }

  const markerFeatures = markers.map((marker) => ({ marker, feature: point([marker.lng, marker.lat]) }))
  const lineFeatures = lines.map((line) => lineString(line.path))
  const cells: InternalCell[] = grid.features.map((feature, index) => {
    const centerFeature = centroid(feature)
    const center = centerFeature.geometry.coordinates as [number, number]
    const direct = markerFeatures.filter((entry) => booleanPointInPolygon(entry.feature, feature)).map((entry) => entry.marker)
    const nearby = markerFeatures
      .filter((entry) => distance(centerFeature, entry.feature, { units: 'kilometers' }) <= options.gridSizeKm * 1.5)
      .map((entry) => entry.marker)
    const nearestStructureKm = lineFeatures.length
      ? Math.min(...lineFeatures.map((line) => pointToLineDistance(centerFeature, line, { units: 'kilometers' })))
      : undefined
    const factors = scoreCell(center, nearby, nearestStructureKm, options.criteria)
    const score = round(factors.reduce((sum, factor) => sum + factor.score, 0))
    const coordinates = feature.geometry.coordinates as Array<Array<[number, number]>>
    return {
      id: `grid-${index + 1}`,
      coordinates,
      center,
      score,
      level: levelFor(score),
      factors,
      pointCount: direct.length,
      ...(nearestStructureKm === undefined ? {} : { nearestStructureKm: round(nearestStructureKm, 2) }),
      region: dominant(nearby.map((marker) => marker.region)),
      dominantMineralKind: dominant(nearby.map((marker) => marker.mineralKind)),
      dominantEra: dominant(nearby.map((marker) => marker.era)),
      markerIds: nearby.map((marker) => marker.id),
      demo: true,
    }
  })

  const minimumScore = options.minimumScore ?? 85
  const targets = connectedTargets(cells, markers, options.gridSizeKm, minimumScore)
  const publicCells: ProspectivityGridCell[] = cells.map(({ markerIds: _markerIds, ...cell }) => cell)
  return {
    gridSizeKm: options.gridSizeKm,
    minimumScore,
    cells: publicCells,
    targets,
    summary: {
      cellCount: cells.length,
      highCount: cells.filter((cell) => cell.level === 'high').length,
      mediumCount: cells.filter((cell) => cell.level === 'medium').length,
      lowCount: cells.filter((cell) => cell.level === 'low').length,
      targetCount: targets.length,
      maxScore: cells.length ? Math.max(...cells.map((cell) => cell.score)) : 0,
    },
    warnings: [DISCLAIMER],
    demo: true,
    disclaimer: DISCLAIMER,
  }
}
