import type {
  GeoEntityType,
  GeoPoint,
  GeoPolyline,
  ProspectivityFactor,
  ProspectivityScore,
  SpatialAnalysis,
  SpatialData,
  SpatialQueryInterpretation,
  SpatialQueryRequest,
  SpatialRegionSummary,
  SpatialTemporalSummary,
} from '../types/index.js'
import { matchMockSpatial } from '../data/spatial-mock.js'
import { getSpatialResults } from './kg.js'
import { ERA_EQUIVALENTS, parseSpatialQuestion } from './spatial-query.js'

export type SpatialSource = 'neo4j' | 'mock' | 'mixed' | 'none'

export interface ResolvedSpatialData {
  data: SpatialData
  source: SpatialSource
}

export interface ResolvedSpatialAnalysis extends ResolvedSpatialData {
  analysis: SpatialAnalysis
}

interface AnchorGeometry {
  name: string
  point?: [number, number]
  path?: Array<[number, number]>
}

const MINERAL_LABELS: Record<string, string[]> = {
  钒钛磁铁矿: ['FeTi', '钒钛磁铁矿', '钛磁铁矿', '钛铁矿'],
  铁矿: ['Fe', '铁矿', '赤铁矿', '磁铁矿'],
  铜镍矿: ['CuNi', '铜镍矿', '镍矿', '镍黄铁矿', '磁黄铁矿'],
  铜矿: ['CuFe', '铜矿', '铜铁矿', '黄铜矿'],
  金矿: ['Au', '金矿'],
  钼矿: ['Mo', '钼矿'],
  钨矿: ['W', '钨矿'],
  锡矿: ['Sn', '锡矿'],
  铅锌矿: ['PbZn', '铅锌矿'],
  铬铁矿: ['Cr', '铬铁矿'],
  稀土矿: ['REE', '稀土矿'],
}

export function hasSpatialData(data: SpatialData): boolean {
  return data.markers.length > 0 || data.polylines.length > 0
}

function emptyData(): SpatialData {
  return { markers: [], polylines: [] }
}

/** Existing lightweight lookup used by the KG endpoint and non-spatial QA. */
export async function resolveSpatialData(keyword: string): Promise<ResolvedSpatialData> {
  const normalized = keyword.trim()
  if (!normalized) return { data: emptyData(), source: 'none' }

  const neo4jData = await getSpatialResults(normalized)
  if (hasSpatialData(neo4jData)) return { data: neo4jData, source: 'neo4j' }

  const mockData = matchMockSpatial(normalized)
  return { data: mockData, source: hasSpatialData(mockData) ? 'mock' : 'none' }
}

function mergeSpatialData(primary: SpatialData, secondary: SpatialData): SpatialData {
  const markerMap = new Map<string, GeoPoint>()
  const lineMap = new Map<string, GeoPolyline>()
  for (const marker of [...primary.markers, ...secondary.markers]) {
    const key = `${marker.name}|${marker.lng.toFixed(5)}|${marker.lat.toFixed(5)}`
    if (!markerMap.has(key)) markerMap.set(key, marker)
  }
  for (const line of [...primary.polylines, ...secondary.polylines]) {
    const key = `${line.label || line.id}|${line.path.length}`
    if (!lineMap.has(key)) lineMap.set(key, line)
  }
  return { markers: Array.from(markerMap.values()), polylines: Array.from(lineMap.values()) }
}

function validCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function distanceKm(a: [number, number], b: [number, number]): number {
  const radians = Math.PI / 180
  const dLat = (b[1] - a[1]) * radians
  const dLng = (b[0] - a[0]) * radians
  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(dLng / 2) ** 2
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function projectPoint(point: [number, number], referenceLat: number): [number, number] {
  const radians = Math.PI / 180
  return [point[0] * 111.32 * Math.cos(referenceLat * radians), point[1] * 110.574]
}

function pointToSegmentKm(point: [number, number], start: [number, number], end: [number, number]): number {
  const referenceLat = (point[1] + start[1] + end[1]) / 3
  const p = projectPoint(point, referenceLat)
  const a = projectPoint(start, referenceLat)
  const b = projectPoint(end, referenceLat)
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const ratio = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p[0] - (a[0] + ratio * dx), p[1] - (a[1] + ratio * dy))
}

function pointToPathKm(point: [number, number], path: Array<[number, number]>): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY
  if (path.length === 1) return distanceKm(point, path[0]!)
  let minimum = Number.POSITIVE_INFINITY
  for (let index = 1; index < path.length; index += 1) {
    minimum = Math.min(minimum, pointToSegmentKm(point, path[index - 1]!, path[index]!))
  }
  return minimum
}

function anchorDistance(point: [number, number], anchor: AnchorGeometry): number {
  if (anchor.path) return pointToPathKm(point, anchor.path)
  return anchor.point ? distanceKm(point, anchor.point) : Number.POSITIVE_INFINITY
}

function normalizeName(value: string): string {
  return value.replace(/[\s·—\-_（）()]/g, '').replace(/(区域|一带|范围)$/, '')
}

function resolveAnchor(data: SpatialData, interpretation: SpatialQueryInterpretation): { anchor?: AnchorGeometry; fallback: boolean } {
  if (interpretation.center) {
    return { anchor: { name: interpretation.anchorName || '指定中心点', point: interpretation.center }, fallback: false }
  }
  if (!interpretation.anchorName) {
    const regionalAnchors = data.markers.filter((marker) => marker.isAnchor)
    if (interpretation.sortBy === 'distance' && regionalAnchors.length) {
      const lng = regionalAnchors.reduce((sum, marker) => sum + marker.lng, 0) / regionalAnchors.length
      const lat = regionalAnchors.reduce((sum, marker) => sum + marker.lat, 0) / regionalAnchors.length
      return {
        anchor: { name: `${regionalAnchors[0]!.region || '查询区域'}锚点中心`, point: [lng, lat] },
        fallback: true,
      }
    }
    return { fallback: false }
  }

  const expected = normalizeName(interpretation.anchorName)
  const point = data.markers.find((marker) => {
    const name = normalizeName(marker.name)
    return name.includes(expected) || expected.includes(name)
  })
  if (point) return { anchor: { name: point.name, point: [point.lng, point.lat] }, fallback: false }

  const line = data.polylines.find((item) => {
    const name = normalizeName(item.label || item.id)
    return name.includes(expected) || expected.includes(name) ||
      (expected.includes('断裂') && item.region && expected.includes(normalizeName(item.region).replace('成矿带', '')))
  })
  if (line) return { anchor: { name: line.label || line.id, path: line.path }, fallback: false }

  const regionalAnchors = data.markers.filter((marker) => marker.isAnchor)
  if (regionalAnchors.length) {
    const lng = regionalAnchors.reduce((sum, marker) => sum + marker.lng, 0) / regionalAnchors.length
    const lat = regionalAnchors.reduce((sum, marker) => sum + marker.lat, 0) / regionalAnchors.length
    return { anchor: { name: `${regionalAnchors[0]!.region || interpretation.anchorName}中心`, point: [lng, lat] }, fallback: true }
  }
  return { fallback: false }
}

function eraMatches(value: string | undefined, requested: string[]): boolean {
  if (!requested.length) return true
  if (!value) return false
  return requested.some((period) => (ERA_EQUIVALENTS[period] || [period]).some((candidate) => value.includes(candidate)))
}

function mineralMatches(marker: GeoPoint, requested: string[]): boolean {
  if (!requested.length || marker.type !== 'Mineral') return true
  const haystack = `${marker.name}|${marker.mineralKind || ''}|${marker.detail || ''}`
  return requested.some((kind) => (MINERAL_LABELS[kind] || [kind]).some((term) => haystack.includes(term)))
}

function markerMatches(marker: GeoPoint, interpretation: SpatialQueryInterpretation): boolean {
  if (interpretation.entityTypes.length && !interpretation.entityTypes.includes(marker.type as GeoEntityType)) return false
  if (!mineralMatches(marker, interpretation.mineralKinds)) return false
  if (!eraMatches(marker.era, interpretation.timePeriods)) return false
  if (interpretation.depositTypes.length && !interpretation.depositTypes.some((type) => marker.depositType?.includes(type))) return false
  if (interpretation.owlTypes.length && !interpretation.owlTypes.every((type) => marker.owlTypes?.includes(type))) return false
  return true
}

function inBbox(point: [number, number], bbox?: [number, number, number, number]): boolean {
  return !bbox || (point[0] >= bbox[0] && point[0] <= bbox[2] && point[1] >= bbox[1] && point[1] <= bbox[3])
}

function lineInBbox(path: Array<[number, number]>, bbox?: [number, number, number, number]): boolean {
  if (!bbox) return true
  if (!path.length) return false
  const lngs = path.map(([lng]) => lng)
  const lats = path.map(([, lat]) => lat)
  return Math.max(...lngs) >= bbox[0] && Math.min(...lngs) <= bbox[2] &&
    Math.max(...lats) >= bbox[1] && Math.min(...lats) <= bbox[3]
}

const OWL_FACTOR_LABELS: Record<string, string> = {
  RockHostedMineral: '赋存岩石证据',
  StructurallyControlledMineral: '构造控制证据',
  AgeConstrainedMineral: '形成时代证据',
}

function nearestStructureDistance(marker: GeoPoint, lines: GeoPolyline[]): number | undefined {
  const regionalLines = marker.region
    ? lines.filter((line) => line.region === marker.region)
    : []
  const candidates = regionalLines.length ? regionalLines : lines
  if (!candidates.length) return undefined
  const point: [number, number] = [marker.lng, marker.lat]
  const minimum = Math.min(...candidates.map((line) => pointToPathKm(point, line.path)))
  return Number.isFinite(minimum) ? Number(minimum.toFixed(2)) : undefined
}

function scoreMineralProspectivity(
  marker: GeoPoint,
  mineralPoints: GeoPoint[],
  structures: GeoPolyline[],
): GeoPoint {
  if (marker.type !== 'Mineral') return marker

  const structureKm = nearestStructureDistance(marker, structures)
  const structureScore = structureKm === undefined
    ? 0
    : Number(Math.max(0, 40 * (1 - structureKm / 40)).toFixed(1))

  const owlWeights: Record<string, number> = {
    RockHostedMineral: 7,
    StructurallyControlledMineral: 7,
    AgeConstrainedMineral: 6,
  }
  const owlTypes = marker.owlTypes || []
  const ontologyScore = Math.min(20, owlTypes.reduce((sum, type) => sum + (owlWeights[type] || 0), 0))

  const geologyParts = [marker.mineralKind, marker.era, marker.depositType]
  const geologyScore = geologyParts.filter(Boolean).length * 5

  const nearbyCount = mineralPoints.filter((candidate) => {
    if (candidate.id === marker.id) return false
    if (marker.mineralKind && candidate.mineralKind && candidate.mineralKind !== marker.mineralKind) return false
    return distanceKm([marker.lng, marker.lat], [candidate.lng, candidate.lat]) <= 12
  }).length
  const densityScore = Number(Math.min(25, nearbyCount * 1.25).toFixed(1))

  const factors: ProspectivityFactor[] = [
    {
      key: 'structure', label: '构造邻近度', score: structureScore, maxScore: 40,
      evidence: structureKm === undefined ? '没有可计算的构造线' : `距最近构造线 ${structureKm.toFixed(2)} 千米`,
    },
    {
      key: 'ontology', label: 'OWL/KG 证据', score: ontologyScore, maxScore: 20,
      evidence: owlTypes.length
        ? owlTypes.map((type) => OWL_FACTOR_LABELS[type] || type).join('、')
        : '当前节点没有物化的 OWL 类别',
    },
    {
      key: 'geology', label: '地质属性完整度', score: geologyScore, maxScore: 15,
      evidence: [
        marker.mineralKind ? '矿种' : '', marker.era ? '年代' : '', marker.depositType ? '成因' : '',
      ].filter(Boolean).join('、') || '缺少矿种、年代和成因属性',
    },
    {
      key: 'density', label: '当前结果聚集度', score: densityScore, maxScore: 25,
      evidence: `当前结果集中，12 千米内有 ${nearbyCount} 个同类矿点`,
    },
  ]
  const score = Number(factors.reduce((sum, factor) => sum + factor.score, 0).toFixed(1))
  const prospectivity: ProspectivityScore = {
    score,
    level: score >= 85 ? 'high' : score >= 75 ? 'medium' : 'low',
    model: 'demo-v1',
    factors,
  }
  return {
    ...marker,
    ...(structureKm !== undefined ? { nearestStructureKm: structureKm } : {}),
    prospectivity,
  }
}

const ERA_ORDER_RULES: Array<[RegExp, number]> = [
  [/太古/, 100],
  [/古元古/, 200], [/中元古/, 210], [/新元古/, 220], [/元古/, 205],
  [/加里东/, 300], [/早古生代/, 310], [/石炭/, 340], [/晚古生代/, 350],
  [/(海西|华力西)/, 360], [/早二叠/, 370], [/晚二叠/, 390], [/二叠/, 380], [/古生代/, 320],
  [/印支/, 410], [/三叠/, 420], [/侏罗/, 440], [/燕山/, 450], [/白垩/, 460], [/中生代/, 430],
  [/古近/, 510], [/喜山/, 520], [/新生代/, 500],
]

export function geologicalEraOrder(era: string): number {
  return ERA_ORDER_RULES.find(([pattern]) => pattern.test(era))?.[1] ?? 9999
}

export function splitGeologicalEras(value?: string): string[] {
  if (!value) return []
  return Array.from(new Set(
    value.split(/\s*(?:\/|、|,|，|;|；)\s*/).map((item) => item.trim()).filter(Boolean),
  ))
}

function buildTemporalSummary(markers: GeoPoint[]): SpatialTemporalSummary {
  const bucketPoints = new Map<string, GeoPoint[]>()
  let unknownEraCount = 0
  for (const marker of markers) {
    const eras = splitGeologicalEras(marker.era)
    if (!eras.length) {
      unknownEraCount += 1
      continue
    }
    for (const era of eras) {
      if (!bucketPoints.has(era)) bucketPoints.set(era, [])
      bucketPoints.get(era)!.push(marker)
    }
  }

  const buckets = Array.from(bucketPoints.entries()).map(([era, points]) => ({
    era,
    order: geologicalEraOrder(era),
    count: points.length,
    mineralCount: points.filter((point) => point.type === 'Mineral').length,
    rockCount: points.filter((point) => point.type === 'Rock').length,
    highProspectivityCount: points.filter((point) => point.prospectivity?.level === 'high').length,
    centroid: [
      Number((points.reduce((sum, point) => sum + point.lng, 0) / points.length).toFixed(5)),
      Number((points.reduce((sum, point) => sum + point.lat, 0) / points.length).toFixed(5)),
    ] as [number, number],
  }))
  buckets.sort((left, right) => left.order - right.order || left.era.localeCompare(right.era, 'zh-CN'))
  return { buckets, unknownEraCount }
}

const MINERAL_KIND_LABELS: Record<string, string> = {
  FeTi: '钒钛磁铁矿', Fe: '铁矿', CuNi: '铜镍矿', CuFe: '铜矿',
  Au: '金矿', Mo: '钼矿', W: '钨矿', Sn: '锡矿', PbZn: '铅锌矿',
  Cr: '铬铁矿', REE: '稀土矿',
}

function dominantValue(values: string[]): string | undefined {
  if (!values.length) return undefined
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))[0]?.[0]
}

function buildRegionSummaries(markers: GeoPoint[], structures: GeoPolyline[]): SpatialRegionSummary[] {
  const groups = new Map<string, GeoPoint[]>()
  for (const marker of markers) {
    const region = marker.region || '未标注区域'
    if (!groups.has(region)) groups.set(region, [])
    groups.get(region)!.push(marker)
  }

  const summaries = [...groups.entries()].map(([region, points]) => {
    const scores = points.flatMap((point) => point.prospectivity ? [point.prospectivity.score] : [])
    const eras = points.flatMap((point) => splitGeologicalEras(point.era))
    const mineralKinds = points.flatMap((point) => point.mineralKind
      ? [MINERAL_KIND_LABELS[point.mineralKind] || point.mineralKind]
      : [])
    const lngs = points.map((point) => point.lng)
    const lats = points.map((point) => point.lat)
    return {
      region,
      count: points.length,
      mineralCount: points.filter((point) => point.type === 'Mineral').length,
      rockCount: points.filter((point) => point.type === 'Rock').length,
      structureCount: structures.filter((line) => line.region === region).length,
      highProspectivityCount: points.filter((point) => point.prospectivity?.level === 'high').length,
      ...(scores.length ? {
        averageProspectivityScore: Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1)),
        maxProspectivityScore: Math.max(...scores),
      } : {}),
      ...(dominantValue(eras) ? { dominantEra: dominantValue(eras) } : {}),
      ...(dominantValue(mineralKinds) ? { dominantMineralKind: dominantValue(mineralKinds) } : {}),
      centroid: [
        Number((lngs.reduce((sum, value) => sum + value, 0) / points.length).toFixed(5)),
        Number((lats.reduce((sum, value) => sum + value, 0) / points.length).toFixed(5)),
      ] as [number, number],
      bbox: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)] as [number, number, number, number],
    }
  })
  summaries.sort((left, right) => right.count - left.count || left.region.localeCompare(right.region, 'zh-CN'))
  return summaries
}

function sourceOf(data: SpatialData): SpatialSource {
  const all = [...data.markers, ...data.polylines]
  if (!all.length) return 'none'
  const mockCount = all.filter((item) => item.isMock).length
  if (mockCount === all.length) return 'mock'
  return mockCount > 0 ? 'mixed' : 'neo4j'
}

export async function analyzeSpatialQuery(request: SpatialQueryRequest): Promise<ResolvedSpatialAnalysis> {
  const text = (request.question || request.keyword || '').trim()
  const parsed = parseSpatialQuestion(text)
  const interpretation: SpatialQueryInterpretation = {
    ...parsed,
    ...(request.center ? { center: request.center } : {}),
    ...(request.radiusKm ? { radiusKm: request.radiusKm } : {}),
    ...(request.entityTypes?.length ? { entityTypes: request.entityTypes } : {}),
    ...(request.sortBy ? { sortBy: request.sortBy } : {}),
  }

  const [neo4jData, mockData] = await Promise.all([
    text ? getSpatialResults(text) : Promise.resolve(emptyData()),
    request.includeMock === false ? Promise.resolve(emptyData()) : Promise.resolve(matchMockSpatial(text, request.entityTypes)),
  ])
  const combined = mergeSpatialData(neo4jData, mockData)
  const candidateCount = combined.markers.length + combined.polylines.length
  const warnings: string[] = []
  const anchorResult = resolveAnchor(combined, interpretation)
  const anchor = anchorResult.anchor
  if (anchorResult.fallback && anchor) warnings.push(`未找到完全同名的参照要素，已使用「${anchor.name}」进行距离计算`)
  if (interpretation.radiusKm && !anchor) warnings.push('识别到范围条件，但没有找到可计算距离的参照要素')

  let markers = combined.markers
    .filter((marker) => validCoordinate(marker.lng) && validCoordinate(marker.lat))
    .filter((marker) => markerMatches(marker, interpretation))
    .filter((marker) => inBbox([marker.lng, marker.lat], request.bbox))
    .map((marker) => {
      if (!anchor) return marker
      return { ...marker, distanceKm: Number(anchorDistance([marker.lng, marker.lat], anchor).toFixed(2)) }
    })
    .filter((marker) => !interpretation.radiusKm || marker.distanceKm === undefined || marker.distanceKm <= interpretation.radiusKm)

  let polylines = combined.polylines
    .filter((line) => lineInBbox(line.path, request.bbox))
    .map((line) => {
      if (!anchor || !line.path.length) return line
      const value = Math.min(...line.path.map((point) => anchorDistance(point, anchor)))
      return { ...line, distanceKm: Number(value.toFixed(2)) }
    })
    .filter((line) => !interpretation.radiusKm || line.distanceKm === undefined || line.distanceKm <= interpretation.radiusKm || line.label === anchor?.name)

  const mineralPoints = markers.filter((marker) => marker.type === 'Mineral')
  markers = markers.map((marker) => scoreMineralProspectivity(marker, mineralPoints, combined.polylines))

  if (interpretation.entityTypes.length && !interpretation.entityTypes.includes('Structure')) polylines = []
  if (interpretation.sortBy === 'score') {
    markers.sort((left, right) => (right.prospectivity?.score ?? -1) - (left.prospectivity?.score ?? -1))
  } else if (interpretation.sortBy === 'distance' && anchor) {
    markers.sort((left, right) => (left.distanceKm ?? Number.POSITIVE_INFINITY) - (right.distanceKm ?? Number.POSITIVE_INFINITY))
    polylines.sort((left, right) => (left.distanceKm ?? Number.POSITIVE_INFINITY) - (right.distanceKm ?? Number.POSITIVE_INFINITY))
  } else {
    markers.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    polylines.sort((left, right) => (left.label || left.id).localeCompare(right.label || right.id, 'zh-CN'))
  }

  const data = { markers, polylines }
  const mockCount = [...markers, ...polylines].filter((item) => item.isMock).length
  if (mockCount) warnings.push(`结果含 ${mockCount} 个功能演示要素，不可作为实际勘查结论`)
  if (interpretation.sortBy === 'score') warnings.push('成矿有利度为 demo-v1 规则模型评分，仅用于功能演示和方案比较')
  if (!markers.length && !polylines.length) warnings.push('当前条件下没有命中带坐标的空间要素')
  const nearest = markers
    .filter((marker) => marker.distanceKm !== undefined)
    .sort((left, right) => left.distanceKm! - right.distanceKm!)[0]
  const scored = markers.filter((marker) => marker.prospectivity)
  const topProspectivity = [...scored].sort((left, right) => right.prospectivity!.score - left.prospectivity!.score)[0]
  const analysis: SpatialAnalysis = {
    interpretation,
    summary: {
      candidateCount,
      matchedCount: markers.length + polylines.length,
      pointCount: markers.length,
      lineCount: polylines.length,
      mockCount,
      highProspectivityCount: scored.filter((marker) => marker.prospectivity?.level === 'high').length,
      mediumProspectivityCount: scored.filter((marker) => marker.prospectivity?.level === 'medium').length,
      lowProspectivityCount: scored.filter((marker) => marker.prospectivity?.level === 'low').length,
      ...(nearest ? { nearestName: nearest.name, nearestDistanceKm: nearest.distanceKm } : {}),
      ...(topProspectivity ? {
        topProspectivityName: topProspectivity.name,
        topProspectivityScore: topProspectivity.prospectivity!.score,
      } : {}),
    },
    temporal: buildTemporalSummary(markers),
    regions: buildRegionSummaries(markers, combined.polylines),
    warnings,
  }
  return { data, source: sourceOf(data), analysis }
}

export async function resolveSpatialForQuestion(question: string): Promise<ResolvedSpatialData & { analysis?: SpatialAnalysis }> {
  const interpretation = parseSpatialQuestion(question)
  if (!interpretation.spatialIntent) return resolveSpatialData(question)
  return analyzeSpatialQuery({ question, includeMock: true })
}
