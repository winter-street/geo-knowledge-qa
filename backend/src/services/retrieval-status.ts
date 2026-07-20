import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkNeo4jAvailability } from './kg.js'
import { getRuntimeSettings, type RuntimeSettings } from './runtime-settings.js'
import { MOCK_SPATIAL_STATS } from '../data/spatial-mock.js'

export interface CapabilityStatus {
  key: 'bge' | 'tfidf' | 'kg' | 'spatial'
  label: string
  available: boolean
  enabled: boolean
  reason: string | null
  details?: string
  source?: string
  demo?: boolean
}

export interface ArtifactStatus {
  key: 'bert' | 'owl'
  label: string
  available: boolean
  online: false
  reason: string | null
  path: string
  updatedAt: string | null
}

export interface RetrievalStatusSnapshot {
  flask: {
    available: boolean
    reason?: string | null
    retrieval?: {
      bge?: { available: boolean; reason?: string | null }
      tfidf?: { available: boolean; reason?: string | null }
    }
  }
  neo4j: { available: boolean; reason: string | null; nodes?: number }
  spatial: { available: boolean; source: string; demo: boolean; featureCount: number }
  bert: { available: boolean; path: string; updatedAt: string | null }
  owl: { available: boolean; path: string; updatedAt: string | null }
}

export interface RetrievalConfigResponse {
  settings: RuntimeSettings
  capabilities: CapabilityStatus[]
  offlineArtifacts: ArtifactStatus[]
  loaded: true
}

export function buildRetrievalConfigResponse(
  settings: RuntimeSettings,
  status: RetrievalStatusSnapshot,
): RetrievalConfigResponse {
  const bge = status.flask.retrieval?.bge
  const tfidf = status.flask.retrieval?.tfidf
  const bgeAvailable = status.flask.available && Boolean(bge?.available)
  const tfidfAvailable = status.flask.available && Boolean(tfidf?.available)

  return {
    settings: { ...settings },
    loaded: true,
    capabilities: [
      {
        key: 'bge', label: 'BGE 语义检索', available: bgeAvailable,
        enabled: settings.ragEnabled && settings.ragMode === 'bge',
        reason: bgeAvailable ? null : bge?.reason || status.flask.reason || 'Flask 检索服务不可用',
        details: 'bge-small-zh-v1.5，512 维语义向量',
      },
      {
        key: 'tfidf', label: 'TF-IDF 关键词检索', available: tfidfAvailable,
        enabled: settings.ragEnabled && settings.ragMode === 'tfidf',
        reason: tfidfAvailable ? null : tfidf?.reason || status.flask.reason || 'Flask 检索服务不可用',
        details: 'jieba 分词与 TF-IDF 余弦相似度',
      },
      {
        key: 'kg', label: '知识图谱检索', available: status.neo4j.available,
        enabled: settings.kgEnabled,
        reason: status.neo4j.available ? null : status.neo4j.reason,
        details: status.neo4j.nodes == null ? undefined : `${status.neo4j.nodes} 个节点`,
      },
      {
        key: 'spatial', label: '空间检索', available: status.spatial.available,
        enabled: settings.spatialEnabled,
        reason: status.spatial.demo ? '包含合成坐标的演示数据，不能作为真实勘查结论' : null,
        details: `${status.spatial.featureCount} 个空间要素`,
        source: status.spatial.source,
        demo: status.spatial.demo,
      },
    ],
    offlineArtifacts: [
      {
        key: 'bert', label: 'BERT-NER 模型', available: status.bert.available,
        online: false,
        reason: status.bert.available ? '离线实体识别产物已生成；当前问答链路不逐次调用' : '未找到 BERT-NER 模型目录',
        path: status.bert.path,
        updatedAt: status.bert.updatedAt,
      },
      {
        key: 'owl', label: 'OWL 本体', available: status.owl.available,
        online: false,
        reason: status.owl.available ? '离线推理产物已生成；问答使用已写入图谱的推理证据' : '未找到 OWL 本体文件',
        path: status.owl.path,
        updatedAt: status.owl.updatedAt,
      },
    ],
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mlServiceDir = path.resolve(__dirname, '../../../ml-service')

function inspectArtifact(artifactPath: string): { available: boolean; path: string; updatedAt: string | null } {
  try {
    const stat = fs.statSync(artifactPath)
    return { available: true, path: artifactPath, updatedAt: stat.mtime.toISOString() }
  } catch {
    return { available: false, path: artifactPath, updatedAt: null }
  }
}

async function fetchFlaskStatus(): Promise<RetrievalStatusSnapshot['flask']> {
  try {
    const response = await fetch('http://127.0.0.1:5000/health', {
      signal: AbortSignal.timeout(2500),
    })
    if (!response.ok) return { available: false, reason: `Flask 健康检查返回 HTTP ${response.status}` }
    const data = await response.json() as RetrievalStatusSnapshot['flask'] & { status?: string }
    return {
      available: data.status === 'ok' || data.available === true,
      reason: data.reason ?? null,
      retrieval: data.retrieval,
    }
  } catch (error) {
    return { available: false, reason: `Flask 检索服务不可用：${(error as Error).message}` }
  }
}

export async function getRetrievalConfigStatus(
  settings: RuntimeSettings = getRuntimeSettings(),
): Promise<RetrievalConfigResponse> {
  const [flask, neo4j] = await Promise.all([
    fetchFlaskStatus(),
    checkNeo4jAvailability(),
  ])
  const bert = inspectArtifact(path.join(mlServiceDir, 'models', 'bert-ner'))
  const owl = inspectArtifact(path.join(mlServiceDir, 'output', 'geo_planning.owl'))
  return buildRetrievalConfigResponse(settings, {
    flask,
    neo4j,
    spatial: {
      available: MOCK_SPATIAL_STATS.totalFeatures > 0,
      source: neo4j.available ? 'neo4j+mock' : 'mock',
      demo: true,
      featureCount: MOCK_SPATIAL_STATS.totalFeatures,
    },
    bert,
    owl,
  })
}
