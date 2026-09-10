export interface Source {
  docId: number
  docTitle: string
  page: number
  snippet: string
  synthetic?: boolean
  isMock?: boolean
}

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
  synthetic?: boolean
  source?: string
  regionContext?: string
  candidateKind?: 'direct' | 'region' | 'owl'
  inferred?: boolean
  fromOwlTypes?: string[]
  toOwlTypes?: string[]
  fromLng?: number
  fromLat?: number
  toLng?: number
  toLat?: number
}

/** 地图标注点（矿产、断裂线端点、岩石分布等） */
export interface GeoPoint {
  id: string
  name: string        // 显示名称
  type: string        // 'Mineral' | 'Rock' | 'Structure' | 'TimePeriod' | 'DepositType'
  lng: number
  lat: number
  detail?: string     // 弹窗（InfoWindow）内容
  region?: string
  mineralKind?: string
  era?: string
  depositType?: string
  owlTypes?: string[]
  isAnchor?: boolean
  isMock?: boolean
  synthetic?: boolean
  evidence?: string
  distanceKm?: number
  nearestStructureKm?: number
  prospectivity?: ProspectivityScore
}

export type GeoEntityType = 'Mineral' | 'Rock' | 'Structure' | 'TimePeriod' | 'DepositType' | 'Region'

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

/** 断裂线 / 构造线 */
export interface GeoPolyline {
  id: string
  type: string
  path: Array<[number, number]>  // [lng, lat][]
  label?: string
  region?: string
  isMock?: boolean
  synthetic?: boolean
  evidence?: string
  distanceKm?: number
}

/** 后端统一返回的空间数据包 */
export interface SpatialData {
  markers?: GeoPoint[]
  polylines?: GeoPolyline[]
}

export interface SpatialFeature {
  type: 'Point' | 'LineString' | 'Polygon'
  coordinates: number[] | number[][] | number[][][]
  properties: {
    name: string
    entityType: string
    description?: string
    id?: string
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
}

export interface SpatialQueryResponse {
  features: SpatialFeature[]
  total: number
  source?: 'neo4j' | 'mock' | 'mixed' | 'none'
  analysis?: SpatialAnalysis
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

export type MapFunctionId =
  | 'query'
  | 'draw'
  | 'buffer'
  | 'heatmap'
  | 'timeline'
  | 'compare'
  | 'prospectivity'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  kgContext?: KGPath[]
  spatialData?: SpatialData
  spatialAnalysis?: SpatialAnalysis
  mapPlan?: MapPlan
  agentPlan?: AgentPlan
  toolTrace?: AgentToolTrace[]
  linkedEntities?: LinkedEntity[]
  citations?: AgentCitation[]
  timestamp: number
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  pinned?: boolean
}

export interface Document {
  docId: number
  title: string
  domain: string
  docType: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  chunkCount: number
  uploadedAt: string
}

export type RetrievalMode = 'rag' | 'kg' | 'hybrid'
export type AgentMode = 'direct' | 'agent'

export type AgentIntent = 'geology_qa' | 'entity_lookup' | 'spatial_analysis' | 'region_comparison' | 'chitchat' | 'clarification'
export type AgentToolName = 'search_documents' | 'query_knowledge_graph' | 'spatial_query' | 'get_entity_detail'
export type AgentToolStatus = 'running' | 'completed' | 'failed' | 'timeout'

export interface LinkedEntity {
  id: string
  name: string
  type: GeoEntityType
  confidence: number
  matchedBy: 'name' | 'alias' | 'context'
  disambiguation: string
}

export interface AgentPlanStep {
  id: string
  label: string
  tool: AgentToolName
  args?: Record<string, unknown>
}

export interface AgentPlan {
  steps: AgentPlanStep[]
}

export interface AgentToolTrace {
  id: string
  toolName: AgentToolName
  argumentSummary?: Record<string, unknown>
  status: AgentToolStatus
  latencyMs?: number
  evidenceCount?: number
  error?: string
}

export interface AgentCitation {
  id: string
  label: string
  kind: 'document' | 'kg'
  docId?: number
  page?: number
  kgPathIndex?: number
}

export interface AgentResponseMetadata {
  conversationId?: string
  intent?: AgentIntent
  linkedEntities?: LinkedEntity[]
  citations?: AgentCitation[]
  toolTrace?: AgentToolTrace[]
  plan?: AgentPlan
}

export interface QaAskRequest {
  question: string
  conversationId?: string
  retrievalMode?: RetrievalMode
  agentMode?: AgentMode
  stream?: boolean
}

export interface QaAskResponse {
  answer: string
  sources: Source[]
  kgContext?: KGPath[]
  spatialData?: SpatialData
  spatialAnalysis?: SpatialAnalysis
  mapPlan?: MapPlan
  conversationId?: string
  intent?: AgentIntent
  linkedEntities?: LinkedEntity[]
  citations?: AgentCitation[]
  toolTrace?: AgentToolTrace[]
  plan?: AgentPlan
}

export interface RuntimeRetrievalSettings {
  ragEnabled: boolean
  ragMode: 'bge' | 'tfidf'
  ragWeight: number
  ragTopK: number
  kgEnabled: boolean
  kgWeight: number
  spatialEnabled: boolean
  spatialWeight: number
  llmModel: string
  maxTokens: number
  temperature: number
  updatedAt: string | null
  updatedBy: string | null
}

export type RuntimeRetrievalSettingsPayload = Omit<RuntimeRetrievalSettings, 'updatedAt' | 'updatedBy'>

export interface RetrievalCapabilityStatus {
  key: 'bge' | 'tfidf' | 'kg' | 'spatial'
  label: string
  available: boolean
  enabled: boolean
  reason: string | null
  details?: string
  source?: string
  demo?: boolean
}

export interface RetrievalArtifactStatus {
  key: 'bert' | 'owl'
  label: string
  available: boolean
  online: false
  reason: string | null
  path: string
  updatedAt: string | null
}

export interface RetrievalConfigResponse {
  settings: RuntimeRetrievalSettings
  capabilities: RetrievalCapabilityStatus[]
  offlineArtifacts: RetrievalArtifactStatus[]
  loaded: boolean
  message?: string
}
