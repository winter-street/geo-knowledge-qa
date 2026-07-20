import request from './request'
import type { SpatialData } from '@/types'
import { normalizeSpatial } from './qa'

export type SpatialSource = 'neo4j' | 'mock' | 'none'
export type SpatialLookup = SpatialData & { source: SpatialSource }

export interface GraphNode {
  id: string
  label: string
  type: string
  owlTypes?: string[]
}

export interface GraphEdge {
  source: string
  target: string
  label: string
  inferred?: boolean
}

export interface Subgraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** 获取知识图谱子图，depth 控制跳数（默认 2） */
export async function getSubgraph(keyword: string, depth: number = 2): Promise<Subgraph> {
  return request.get('/kg/subgraph', { params: { keyword, depth } })
}

/**
 * 获取关键词对应的空间数据（矿产点 / 断裂线等）。
 * 对应后端 GET /api/kg/spatial?keyword=xxx，可脱离问答流程单独测试地图渲染。
 * 后端优先返回 Neo4j 坐标；只有关键词命中明确演示主题时才返回 mock，
 * 其余情况统一降级为空，不抛错。
 */
export async function getSpatial(keyword: string): Promise<SpatialLookup> {
  try {
    const raw = await request.get<unknown, SpatialData & { source?: SpatialSource }>('/kg/spatial', { params: { keyword } })
    const data = normalizeSpatial(raw) ?? { markers: [], polylines: [] }
    const source: SpatialSource = raw?.source === 'neo4j' || raw?.source === 'mock'
      ? raw.source
      : 'none'
    return { ...data, source }
  } catch {
    return { markers: [], polylines: [], source: 'none' }
  }
}
