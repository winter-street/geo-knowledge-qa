/** 文本块 */
export interface Chunk {
  id: number
  content: string
  docTitle: string
  page: number
  docType: string
}

/** 检索来源（对齐前端 Source 类型） */
export interface Source {
  docId: number
  docTitle: string
  page: number
  snippet: string
}

/** 知识图谱关系路径 */
export interface KGPathScoreReason {
  code: 'exact_entity' | 'keyword' | 'region' | 'relation_intent' | 'owl_supplement'
  value: number
  detail: string
}

export interface KGPath {
  from: string
  relation: string
  relationType?: string
  to: string
  score?: number
  scoreReasons?: KGPathScoreReason[]
  isMock?: boolean
  source?: string
  regionContext?: string
  candidateKind?: 'direct' | 'region' | 'owl'
  /** OWL 推理得出的关系（非原文直接提取） */
  inferred?: boolean
  /** 起点由 OWL 定义类推理得到的类别 */
  fromOwlTypes?: string[]
  /** 终点由 OWL 定义类推理得到的类别 */
  toOwlTypes?: string[]
  /** 起点坐标（实体含空间属性时有值） */
  fromLng?: number
  fromLat?: number
  /** 终点坐标 */
  toLng?: number
  toLat?: number
}

/** 知识图谱节点 */
export interface GraphNode {
  id: string
  label: string
  type: string
  /** 由 OWL 定义类推理得到的类别 */
  owlTypes?: string[]
}

/** 知识图谱边 */
export interface GraphEdge {
  source: string
  target: string
  label: string
  /** OWL 推理得出的关系 */
  inferred?: boolean
}

/** 图谱子图 */
export interface Subgraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// ============================================================
// 地质实体类型（地质找矿 KG Schema）
// ============================================================

/** 地质实体类型枚举 */
export type GeoEntityType = 'Mineral' | 'Rock' | 'Structure' | 'TimePeriod' | 'DepositType' | 'Region'

/** 地质实体基础属性 */
export interface GeoEntity {
  name: string
  type: GeoEntityType
  properties: Record<string, unknown>
}

/** 矿产节点 */
export interface MineralEntity extends GeoEntity {
  type: 'Mineral'
  properties: {
    mineralType: string       // 矿产类型（如"铅锌矿""铁矿"）
    geneticType?: string      // 成因类型（如"热液充填型""沉积变质型"）
    hostRock?: string         // 赋矿围岩
    era?: string              // 成矿时代
    scale?: string            // 规模（大型/中型/小型）
    location?: string         // 位置描述
  }
}

/** 岩石节点 */
export interface RockEntity extends GeoEntity {
  type: 'Rock'
  properties: {
    category: string          // 大类（岩浆岩/沉积岩/变质岩）
    subcategory?: string      // 亚类
    era?: string              // 所属地质年代
    composition?: string      // 矿物组成
    texture?: string          // 结构
  }
}

/** 构造节点 */
export interface StructureEntity extends GeoEntity {
  type: 'Structure'
  properties: {
    category: string          // 断裂/褶皱/韧性剪切带
    orientation?: string      // 走向
    dip?: string              // 倾向/倾角
    lengthKm?: number         // 长度
  }
}

// ============================================================
// 空间数据（地图可视化）
// ============================================================

/** 地图标注点（矿产、构造端点等） */
export interface GeoPoint {
  id: string
  name: string        // 显示名称
  type: string        // 'Mineral' | 'Structure' | 'Rock' | 'Era'
  lng: number
  lat: number
  detail?: string     // 弹窗内容
  region?: string
  mineralKind?: string
  era?: string
  depositType?: string
  owlTypes?: string[]
  isAnchor?: boolean
  isMock?: boolean
  evidence?: string
  distanceKm?: number
  nearestStructureKm?: number
  prospectivity?: ProspectivityScore
}

export type ProspectivityLevel = 'high' | 'medium' | 'low'

export interface ProspectivityFactor {
  key: 'structure' | 'ontology' | 'geology' | 'density'
  label: string
  score: number
  maxScore: number
  evidence: string
}

export interface ProspectivityScore {
  score: number
  level: ProspectivityLevel
  model: 'demo-v1'
  factors: ProspectivityFactor[]
}

/** 断裂线/构造线 */
export interface GeoPolyline {
  id: string
  type: string        // 'fault' | 'fold' | 'boundary'
  path: Array<[number, number]>  // [lng, lat][]
  label?: string
  region?: string
  isMock?: boolean
  evidence?: string
  distanceKm?: number
}

/** 后端统一返回的空间数据包 */
export interface SpatialData {
  markers: GeoPoint[]
  polylines: GeoPolyline[]
}

/** 空间要素（GeoJSON Feature 精简版，供空间查询接口使用） */
export interface SpatialFeature {
  type: 'Point' | 'LineString' | 'Polygon'
  coordinates: number[] | number[][] | number[][][]
  properties: {
    name: string
    entityType: GeoEntityType
    description?: string
    [key: string]: unknown
  }
}

/** 空间图层 */
export interface SpatialLayer {
  name: string
  label: string
  featureCount: number
  bbox?: [number, number, number, number]  // [minLng, minLat, maxLng, maxLat]
}

/** POST /api/spatial/query 请求 */
export interface SpatialQueryRequest {
  keyword?: string
  question?: string
  entityTypes?: GeoEntityType[]
  bbox?: [number, number, number, number]
  center?: [number, number]
  radiusKm?: number
  sortBy?: 'distance' | 'name' | 'score'
  includeMock?: boolean
}

export interface SpatialQueryInterpretation {
  originalText: string
  spatialIntent: boolean
  anchorName?: string
  center?: [number, number]
  radiusKm?: number
  entityTypes: GeoEntityType[]
  mineralKinds: string[]
  timePeriods: string[]
  depositTypes: string[]
  owlTypes: string[]
  sortBy: 'distance' | 'name' | 'score'
}

export interface SpatialAnalysisSummary {
  candidateCount: number
  matchedCount: number
  pointCount: number
  lineCount: number
  mockCount: number
  nearestName?: string
  nearestDistanceKm?: number
  highProspectivityCount: number
  mediumProspectivityCount: number
  lowProspectivityCount: number
  topProspectivityName?: string
  topProspectivityScore?: number
}

export interface SpatialTemporalBucket {
  era: string
  order: number
  count: number
  mineralCount: number
  rockCount: number
  highProspectivityCount: number
  centroid: [number, number]
}

export interface SpatialTemporalSummary {
  buckets: SpatialTemporalBucket[]
  unknownEraCount: number
}

export interface SpatialRegionSummary {
  region: string
  count: number
  mineralCount: number
  rockCount: number
  structureCount: number
  highProspectivityCount: number
  averageProspectivityScore?: number
  maxProspectivityScore?: number
  dominantEra?: string
  dominantMineralKind?: string
  centroid: [number, number]
  bbox: [number, number, number, number]
}

export interface SpatialAnalysis {
  interpretation: SpatialQueryInterpretation
  summary: SpatialAnalysisSummary
  temporal: SpatialTemporalSummary
  regions: SpatialRegionSummary[]
  warnings: string[]
}

export type MapAction =
  | { type: 'query'; question: string }
  | { type: 'filter-region'; regions: string[] }
  | { type: 'filter-era'; eras: string[] }
  | { type: 'filter-entity'; entityTypes: GeoEntityType[] }
  | { type: 'set-result-mode'; mode: 'query' | 'score' }
  | { type: 'buffer'; radiusKm: number; anchorName?: string; targetType?: GeoEntityType }
  | { type: 'heatmap'; enabled: boolean }
  | { type: 'timeline'; mode: 'all' | 'single' | 'play'; era?: string }
  | { type: 'compare-regions'; regions: string[] }
  | { type: 'grid-prediction'; gridSizeKm: 5 | 10 | 20; minimumScore?: number }
  | { type: 'fit-bounds' }
  | { type: 'suggest-export'; format: 'geojson' | 'csv' }

export type MapActionType = MapAction['type']

export interface MapPlan {
  id: string
  version: 1
  title: string
  autoExecute: boolean
  openFullMap: boolean
  actions: MapAction[]
  warnings: string[]
}

export interface ProspectivityGridFactor {
  key: 'structure' | 'density' | 'ontology' | 'geology'
  label: string
  score: number
  maxScore: number
  evidence: string
}

export interface ProspectivityGridCell {
  id: string
  coordinates: Array<Array<[number, number]>>
  center: [number, number]
  score: number
  level: ProspectivityLevel
  factors: ProspectivityGridFactor[]
  pointCount: number
  nearestStructureKm?: number
  region?: string
  dominantMineralKind?: string
  dominantEra?: string
  demo: true
}

export interface ProspectivityTarget {
  id: string
  name: string
  coordinates: Array<Array<Array<[number, number]>>>
  cellCount: number
  areaKm2: number
  averageScore: number
  maxScore: number
  pointCount: number
  minimumScore: number
  dominantMineralKind?: string
  dominantEra?: string
  demo: true
}

export interface ProspectivityGridResult {
  gridSizeKm: 5 | 10 | 20
  minimumScore: number
  cells: ProspectivityGridCell[]
  targets: ProspectivityTarget[]
  summary: {
    cellCount: number
    highCount: number
    mediumCount: number
    lowCount: number
    targetCount: number
    maxScore: number
  }
  warnings: string[]
  demo: true
  disclaimer: string
  source?: 'neo4j' | 'mock' | 'mixed' | 'none'
  spatialData?: SpatialData
  analysis?: SpatialAnalysis
}

/** POST /api/spatial/query 响应 */
export interface SpatialQueryResponse {
  features: SpatialFeature[]
  total: number
  source?: 'neo4j' | 'mock' | 'mixed' | 'none'
  analysis?: SpatialAnalysis
}

// ============================================================
// Q&A
// ============================================================

/** 检索模式 */
export type RetrievalMode = 'rag' | 'kg' | 'hybrid'

/** POST /api/qa/ask 请求 */
export interface QaAskRequest {
  question: string
  retrievalMode?: RetrievalMode
}

/** POST /api/qa/ask 响应 */
export interface QaAskResponse {
  answer: string
  sources: Source[]
  kgContext: KGPath[]
  /** 空间数据（地图标注用），无空间数据时 markers/polylines 均为空数组 */
  spatialData: SpatialData
  spatialAnalysis?: SpatialAnalysis
  mapPlan?: MapPlan
}

// ============================================================
// 文档 & 配置
// ============================================================

/** 文档记录（对齐前端 Document 类型） */
export interface DocumentRecord {
  docId: number
  title: string
  domain: string
  docType: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  chunkCount: number
  uploadedAt: string
}

/** 环境配置 */
export interface AppConfig {
  port: number
  neo4j: {
    uri: string
    user: string
    password: string
  }
  deepseek: {
    apiKey: string
    model: string
    baseURL: string
  }
  tongyi?: {
    apiKey: string
    model: string
    baseURL: string
  }
  retrieval: {
    topK: number
  }
  jwtSecret: string
}
