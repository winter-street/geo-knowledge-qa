import neo4j, { type Driver, type Session } from 'neo4j-driver'
import { config } from '../config.js'
import type { EntityLinkCandidate, KGPath, Subgraph, GeoEntityType } from '../types/index.js'
import {
  analyzeKgQuestion,
  type KGQueryAnalysis,
} from './kg-query-analysis.js'
import {
  rankKgPaths,
  type KGPathCandidate,
} from './kg-ranking.js'
import { tokenize } from './tokenizer.js'
import { getSyntheticDemoRepository, syntheticDemoEnabled } from './synthetic-demo.js'

// ============================================================
// 地质知识图谱 — 实体类型常量
// ============================================================

/** 地质找矿 KG Schema 节点类型 */
export const GEO_ENTITY_TYPES: GeoEntityType[] = [
  'Mineral',      // 矿产
  'Rock',         // 岩石
  'Structure',    // 构造
  'TimePeriod',   // 地质年代
  'DepositType',  // 矿床成因类型
  'Region',       // 空间区域
]

/** 地质找矿 KG Schema 关系类型 */
export const GEO_RELATION_TYPES = [
  'HOSTED_IN',         // 矿产 → 赋存于 → 岩石
  'CONTROLLED_BY',     // 矿产 → 受控于 → 构造
  'FORMED_IN',         // 矿产 → 形成于 → 地质年代
  'BELONGS_TO',        // 岩石/构造 → 属于 → 地质年代
  'LIES_IN',           // 实体 → 位于 → 空间区域
  'ASSOCIATED_WITH',   // 矿产 ↔ 伴生关系
  'CUTS',              // 构造 → 切穿 → 岩石
  'REFERENCES',        // 文档 → 引用 → 实体
]

/** 关系类型中文映射 */
const REL_CN: Record<string, string> = {
  HOSTED_IN: '赋存于',
  CONTROLLED_BY: '受控于',
  FORMED_IN: '形成于',
  BELONGS_TO: '属于',
  LIES_IN: '位于',
  ASSOCIATED_WITH: '伴生',
  CUTS: '切穿',
  REFERENCES: '引用',
  RELATED_TO: '关联',
  GOVERNS: '管控',
  CONSTRAINS: '约束',
  SUPPORTS: '支撑',
  PROTECTS: '保护',
  CLASSIFIES: '分类',
}

/** 将关系名转为中文 */
function cnRel(en: string): string {
  return REL_CN[en] || en
}

let driver: Driver | null = null
let connected = false

/** 初始化 Neo4j 连接 */
export function initNeo4j(): void {
  if (syntheticDemoEnabled()) {
    connected = false
    console.log('[kg] Synthetic demo enabled; Neo4j initialization skipped.')
    return
  }
  const { uri, user, password } = config.neo4j
  if (!password || password === 'password') {
    console.warn('[kg] Neo4j 密码未配置或为默认值，KG 功能不可用')
    connected = false
    return
  }

  try {
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      maxConnectionLifetime: 3 * 60 * 60 * 1000,
      maxConnectionPoolSize: 10,
      connectionAcquisitionTimeout: 5000,
    })
    connected = true
    console.log(`[kg] Neo4j 已连接: ${uri}`)
  } catch (err) {
    console.warn('[kg] Neo4j 连接失败，KG 检索将返回空:', (err as Error).message)
    connected = false
  }
}

/** 获取 session */
function getSession(): Session | null {
  if (!driver || !connected) return null
  return driver.session({ database: 'neo4j' })
}

/**
 * 按问题文本搜索地质实体并获取多跳关系路径
 *
 * @param question     用户问题
 * @param entityTypes  可选：限定实体类型（不传则搜索所有节点）
 */
export async function searchEntities(
  question: string,
  entityTypes?: GeoEntityType[]
): Promise<KGPath[]> {
  if (syntheticDemoEnabled()) {
    return getSyntheticDemoRepository().searchKnowledgeGraph(question)
  }
  const session = getSession()
  if (!session) {
    console.log('[kg] Neo4j 不可用，跳过 KG 检索')
    return []
  }

  try {
    return await searchWithSession(question, entityTypes, session)
  } catch (err) {
    console.warn('[kg] Cypher 查询失败:', (err as Error).message)
    return []
  } finally {
    await session.close()
  }
}

export interface KgQueryRecord {
  get(key: string): unknown
}

export interface KgQueryResult {
  records: KgQueryRecord[]
}

export type KgQueryRunner = (
  cypher: string,
  params: Record<string, unknown>,
) => Promise<KgQueryResult>

export const COMBINED_KG_CYPHER = `
CALL {
  WITH $keywords AS keywords, $entityTypes AS entityTypes
  MATCH (n)-[r]->(m)
  WHERE any(keyword IN keywords WHERE
      coalesce(n.name, n.title, '') CONTAINS keyword
      OR coalesce(m.name, m.title, '') CONTAINS keyword)
    AND type(r) <> 'REFERENCES'
    AND NOT n:Document AND NOT m:Document
    AND NOT n:RejectedEntity AND NOT m:RejectedEntity
    AND (size(entityTypes) = 0 OR any(entityType IN entityTypes WHERE
      entityType IN labels(n) OR entityType IN labels(m)))
  RETURN coalesce(n.name, n.title) AS from,
         type(r) AS relationType,
         coalesce(m.name, m.title) AS to,
         'direct' AS candidateKind,
         null AS regionContext,
         1 AS candidatePriority,
         r.inferred AS inferred,
         n.owlTypes AS fromOwlTypes,
         m.owlTypes AS toOwlTypes,
         coalesce(n.lng, n.mockLng) AS fromLng,
         coalesce(n.lat, n.mockLat) AS fromLat,
         coalesce(m.lng, m.mockLng) AS toLng,
         coalesce(m.lat, m.mockLat) AS toLat,
         coalesce(r.isMock, false) OR coalesce(n.isMock, false) OR coalesce(m.isMock, false) AS isMock,
         coalesce(r.source, n.source, m.source) AS source
  UNION ALL
  WITH $regionTerms AS regionTerms, $entityTypes AS entityTypes
  MATCH (region:Region)
  WHERE any(regionTerm IN regionTerms WHERE region.name CONTAINS regionTerm)
  MATCH (member)-[:LIES_IN]->(region)
  MATCH (member)-[r]->(m)
  WHERE type(r) <> 'REFERENCES'
    AND NOT member:RejectedEntity AND NOT m:RejectedEntity
    AND (size(entityTypes) = 0 OR any(entityType IN entityTypes WHERE
      entityType IN labels(member) OR entityType IN labels(m)))
  RETURN member.name AS from,
         type(r) AS relationType,
         coalesce(m.name, m.title) AS to,
         'region' AS candidateKind,
         region.name AS regionContext,
         0 AS candidatePriority,
         r.inferred AS inferred,
         member.owlTypes AS fromOwlTypes,
         m.owlTypes AS toOwlTypes,
         coalesce(member.lng, member.mockLng) AS fromLng,
         coalesce(member.lat, member.mockLat) AS fromLat,
         coalesce(m.lng, m.mockLng) AS toLng,
         coalesce(m.lat, m.mockLat) AS toLat,
         coalesce(r.isMock, false) OR coalesce(member.isMock, false) OR coalesce(m.isMock, false) AS isMock,
         coalesce(r.source, member.source, m.source) AS source
  UNION ALL
  WITH $owlRules AS owlRules, $relationIntents AS relationIntents
  MATCH (n:Mineral)-[r]->(m)
  WHERE any(owlRule IN owlRules WHERE owlRule IN coalesce(n.owlTypes, []))
    AND (size(relationIntents) = 0 OR type(r) IN relationIntents)
    AND type(r) <> 'REFERENCES'
    AND NOT m:RejectedEntity
  RETURN n.name AS from,
         type(r) AS relationType,
         coalesce(m.name, m.title) AS to,
         'owl' AS candidateKind,
         null AS regionContext,
         2 AS candidatePriority,
         r.inferred AS inferred,
         n.owlTypes AS fromOwlTypes,
         m.owlTypes AS toOwlTypes,
         coalesce(n.lng, n.mockLng) AS fromLng,
         coalesce(n.lat, n.mockLat) AS fromLat,
         coalesce(m.lng, m.mockLng) AS toLng,
         coalesce(m.lat, m.mockLat) AS toLat,
         coalesce(r.isMock, false) OR coalesce(n.isMock, false) OR coalesce(m.isMock, false) AS isMock,
         coalesce(r.source, n.source, m.source) AS source
}
WITH * WHERE from IS NOT NULL AND to IS NOT NULL
RETURN from, relationType, to, candidateKind, regionContext,
       inferred, fromOwlTypes, toOwlTypes,
       fromLng, fromLat, toLng, toLat, isMock, source
ORDER BY candidatePriority, from, relationType, to
LIMIT 60
`

function optionalValue<T>(record: KgQueryRecord, key: string): T | undefined {
  const value = record.get(key)
  return value == null ? undefined : value as T
}

function mapCandidateRecords(records: KgQueryRecord[]): KGPathCandidate[] {
  return records.map((record) => {
    const relationType = String(record.get('relationType'))
    return {
      from: String(record.get('from')),
      relation: cnRel(relationType),
      relationType,
      to: String(record.get('to')),
      candidateKind: String(record.get('candidateKind')) as KGPathCandidate['candidateKind'],
      fromOwlTypes: optionalValue<string[]>(record, 'fromOwlTypes') ?? [],
      toOwlTypes: optionalValue<string[]>(record, 'toOwlTypes') ?? [],
      ...(optionalValue<boolean>(record, 'inferred') !== undefined
        ? { inferred: Boolean(record.get('inferred')) }
        : {}),
      ...(optionalValue<boolean>(record, 'isMock') ? { isMock: true } : {}),
      ...(optionalValue<string>(record, 'source') ? { source: String(record.get('source')) } : {}),
      ...(optionalValue<string>(record, 'regionContext')
        ? { regionContext: String(record.get('regionContext')) }
        : {}),
      ...(optionalValue<number>(record, 'fromLng') !== undefined
        ? {
            fromLng: Number(record.get('fromLng')),
            fromLat: Number(record.get('fromLat')),
          }
        : {}),
      ...(optionalValue<number>(record, 'toLng') !== undefined
        ? {
            toLng: Number(record.get('toLng')),
            toLat: Number(record.get('toLat')),
          }
        : {}),
    }
  })
}

async function executeKgCandidateQuery(
  analysis: KGQueryAnalysis,
  entityTypes: GeoEntityType[] | undefined,
  run: KgQueryRunner,
): Promise<KGPathCandidate[]> {
  if (
    analysis.keywords.length === 0
    && analysis.regionTerms.length === 0
    && analysis.owlRules.length === 0
  ) return []

  const result = await run(COMBINED_KG_CYPHER, {
    keywords: analysis.keywords,
    regionTerms: analysis.regionTerms,
    relationIntents: analysis.relationIntents,
    owlRules: analysis.owlRules,
    entityTypes: entityTypes ?? [],
  })
  return mapCandidateRecords(result.records)
}

export async function queryKgCandidates(
  question: string,
  entityTypes: GeoEntityType[] | undefined,
  run: KgQueryRunner,
): Promise<KGPathCandidate[]> {
  return executeKgCandidateQuery(analyzeKgQuestion(question), entityTypes, run)
}

async function searchWithSession(
  question: string,
  entityTypes: GeoEntityType[] | undefined,
  session: Session,
): Promise<KGPath[]> {
  const analysis = analyzeKgQuestion(question)
  const candidates = await executeKgCandidateQuery(
    analysis,
    entityTypes,
    (cypher, params) => session.run(cypher, params),
  )
  const ranked = rankKgPaths(candidates, analysis, question)
  console.log(
    `[kg] 单次组合查询返回 ${candidates.length} 条候选，排序后 ${ranked.length} 条` +
    `（关键词: ${analysis.keywords.join('、') || '无'}）`,
  )
  return ranked
}

/**
 * 获取子图数据（供前端 GraphView 知识图谱可视化）
 *
 * @param query        搜索关键词
 * @param entityTypes  可选：限定实体类型
 * @param depth        跳数（1=一跳，2=二跳，默认 2）
 */
export async function getSubgraph(
  query: string,
  entityTypes?: GeoEntityType[],
  depth: number = 2
): Promise<Subgraph> {
  if (syntheticDemoEnabled()) {
    return getSyntheticDemoRepository().getSubgraph(query)
  }
  const session = getSession()
  if (!session) return { nodes: [], edges: [] }

  // 分词提取关键词
  const tokens = tokenize(query)
  const keywords = tokens.filter((t) => t.length >= 2).slice(0, 3)
  if (keywords.length === 0) return { nodes: [], edges: [] }

  const nodeMap = new Map<string, { id: string; label: string; type: string; owlTypes?: string[] }>()
  const edgeSet = new Set<string>()
  const edgeList: Subgraph['edges'] = []

  try {
    for (const kw of keywords) {
      // 多跳查询：先找到种子节点，再展开 N 跳内所有关系（排除 Document 元数据节点）
      const result = await session.run(
        `
        MATCH path = (seed)-[r*1..${depth}]-(m)
        WHERE (seed.name CONTAINS $keyword OR seed.title CONTAINS $keyword)
          AND NOT 'Document' IN labels(seed)
          AND NOT 'RejectedEntity' IN labels(seed)
        WITH nodes(path) AS ns, relationships(path) AS rs
        UNWIND ns AS n
        WITH DISTINCT n, rs
        UNWIND rs AS r
        WITH DISTINCT n, r, startNode(r) AS a, endNode(r) AS b
        WHERE NOT 'Document' IN labels(a) AND NOT 'Document' IN labels(b)
          AND NOT 'RejectedEntity' IN labels(a) AND NOT 'RejectedEntity' IN labels(b)
        RETURN id(a) AS sourceId, labels(a) AS sourceLabels,
               COALESCE(a.name, a.title) AS sourceName,
               a.owlTypes AS sourceOwlTypes,
               a.lng AS sourceLng, a.lat AS sourceLat,
               type(r) AS relType, r.inferred AS inferred,
               id(b) AS targetId, labels(b) AS targetLabels,
               COALESCE(b.name, b.title) AS targetName,
               b.owlTypes AS targetOwlTypes,
               b.lng AS targetLng, b.lat AS targetLat
        LIMIT 20
        `,
        { keyword: kw }
      )

      for (const record of result.records) {
        const sId = record.get('sourceId').toString()
        const tId = record.get('targetId').toString()
        const sName = record.get('sourceName') || '未知'
        const tName = record.get('targetName') || '未知'
        const sLabels = record.get('sourceLabels') as string[]
        const tLabels = record.get('targetLabels') as string[]
        const sOwlTypes = (record.get('sourceOwlTypes') || []) as string[]
        const tOwlTypes = (record.get('targetOwlTypes') || []) as string[]
        const relType = record.get('relType')
        const inferred = record.get('inferred')

        if (!nodeMap.has(sId)) {
          nodeMap.set(sId, {
            id: sId, label: sName, type: sLabels[0] || 'Unknown',
            ...(sOwlTypes.length ? { owlTypes: sOwlTypes } : {}),
          })
        }
        if (!nodeMap.has(tId)) {
          nodeMap.set(tId, {
            id: tId, label: tName, type: tLabels[0] || 'Unknown',
            ...(tOwlTypes.length ? { owlTypes: tOwlTypes } : {}),
          })
        }

        const edgeKey = `${sId}|${relType}|${tId}`
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey)
          edgeList.push({
            source: sId, target: tId, label: cnRel(relType),
            ...(inferred != null ? { inferred: !!inferred } : {}),
          })
        }
      }
    }

    console.log(`[kg] subgraph: ${nodeMap.size} nodes, ${edgeList.length} edges (depth=${depth})`)
    return { nodes: Array.from(nodeMap.values()), edges: edgeList }
  } catch (err) {
    console.warn('[kg] 子图查询失败:', (err as Error).message)
    return { nodes: [], edges: [] }
  } finally {
    await session.close()
  }
}

/**
 * 空间检索：查询问题相关的带坐标地质实体，返回地图标注数据
 *
 * @param question  用户问题
 * @returns         点标记（矿产/岩石等）+ 线标记（构造/断裂等）
 *                  无坐标数据时返回空数组，不报错
 */
export async function getSpatialResults(question: string): Promise<import('../types/index.js').SpatialData> {
  if (syntheticDemoEnabled()) {
    return getSyntheticDemoRepository().getSpatialData(question)
  }
  const session = getSession()
  if (!session) {
    console.log('[kg] Neo4j 不可用，spatial 返回空')
    return { markers: [], polylines: [] }
  }

  const tokens = tokenize(question)
  const keywords = tokens.filter((t) => t.length >= 2)
  if (keywords.length === 0) return { markers: [], polylines: [] }

  const markers: import('../types/index.js').GeoPoint[] = []
  const polylines: import('../types/index.js').GeoPolyline[] = []
  const seenIds = new Set<string>()

  try {
    for (const kw of keywords.slice(0, 3)) {
      // 查询有坐标属性的节点（点状实体 → markers）
      const pointResult = await session.run(
        `
        MATCH (n)
        WHERE (n.name CONTAINS $keyword OR n.title CONTAINS $keyword)
          AND n.lng IS NOT NULL AND n.lat IS NOT NULL
          AND NOT n:RejectedEntity
        OPTIONAL MATCH (n)-[:FORMED_IN]->(time:TimePeriod)
        OPTIONAL MATCH (n)-[:LIES_IN]->(region:Region)
        RETURN n.name AS name, labels(n) AS labels,
               n.lng AS lng, n.lat AS lat,
               n.description AS description,
               n.owlTypes AS owlTypes,
               n.era AS era,
               n.depositType AS depositType,
               collect(DISTINCT time.name) AS relatedEras,
               collect(DISTINCT region.name) AS relatedRegions
        LIMIT 10
        `,
        { keyword: kw }
      )

      for (const record of pointResult.records) {
        const id = record.get('name')
        if (seenIds.has(id)) continue
        seenIds.add(id)

        const labels: string[] = record.get('labels')
        const type = labels[0] || 'Unknown'
        const lng = record.get('lng')
        const lat = record.get('lat')
        const desc = record.get('description')
        const owlTypes: string[] = record.get('owlTypes') || []
        const relatedEras: string[] = record.get('relatedEras') || []
        const relatedRegions: string[] = record.get('relatedRegions') || []
        const era = record.get('era') || relatedEras.join(' / ')
        const region = relatedRegions.join(' / ')
        const depositType = record.get('depositType')

        markers.push({
          id,
          name: id,
          type,
          lng: typeof lng === 'number' ? lng : parseFloat(String(lng)),
          lat: typeof lat === 'number' ? lat : parseFloat(String(lat)),
          ...(desc ? { detail: String(desc) } : {}),
          ...(owlTypes.length ? { owlTypes } : {}),
          ...(era ? { era: String(era) } : {}),
          ...(region ? { region } : {}),
          ...(depositType ? { depositType: String(depositType) } : {}),
          isMock: false,
          evidence: 'Neo4j 实体坐标及其知识图谱关系',
        })
      }

      // 查询有 path 属性的实体（线状实体 → polylines，如断裂带）
      const lineResult = await session.run(
        `
        MATCH (n)
        WHERE (n.name CONTAINS $keyword OR n.title CONTAINS $keyword)
          AND n.path IS NOT NULL
          AND NOT n:RejectedEntity
        RETURN n.name AS name, labels(n) AS labels, n.path AS path,
               n.region AS region
        LIMIT 5
        `,
        { keyword: kw }
      )

      for (const record of lineResult.records) {
        const id = record.get('name')
        if (seenIds.has(`line-${id}`)) continue
        seenIds.add(`line-${id}`)

        const labels: string[] = record.get('labels')
        const rawPath = record.get('path')
        const region = record.get('region')

        // path 支持 JSON 数组字符串 或 Neo4j Point list
        let pathCoords: [number, number][] = []
        if (typeof rawPath === 'string') {
          try { pathCoords = JSON.parse(rawPath) } catch { continue }
        } else if (Array.isArray(rawPath)) {
          pathCoords = rawPath.map((p: any) =>
            Array.isArray(p) ? [Number(p[0]), Number(p[1])] as [number, number] : [Number(p.x), Number(p.y)] as [number, number]
          )
        }

        if (pathCoords.length >= 2) {
          polylines.push({
            id: `line-${id}`,
            type: labels[0] || 'fault',
            path: pathCoords,
            label: id,
            ...(region ? { region: String(region) } : {}),
            isMock: false,
            evidence: 'Neo4j 构造实体路径',
          })
        }
      }
    }

    console.log(`[kg] spatial: ${markers.length} markers + ${polylines.length} polylines (关键词: ${keywords.slice(0, 3).join(', ')})`)
    return { markers, polylines }
  } catch (err) {
    console.warn('[kg] 空间检索失败:', (err as Error).message)
    return { markers: [], polylines: [] }
  } finally {
    await session.close()
  }
}

/** 获取单个实体详情 */
export async function getEntityDetail(entityId: string): Promise<Record<string, unknown> | null> {
  if (syntheticDemoEnabled()) {
    return getSyntheticDemoRepository().getEntityDetail(entityId)
  }
  const session = getSession()
  if (!session) return null
  try {
    const result = await session.run(
      'MATCH (n) WHERE elementId(n) = $entityId RETURN n.name AS name, labels(n) AS labels, properties(n) AS props',
      { entityId }
    )
    if (result.records.length === 0) return null
    const r = result.records[0]!
    return {
      entityId,
      name: r.get('name') || '未知',
      type: (r.get('labels') as string[])[0] || 'Unknown',
      ...r.get('props'),
    }
  } finally {
    await session.close()
  }
}

/** 更新实体属性 */
export async function updateEntity(entityId: string, props: Record<string, unknown>): Promise<boolean> {
  if (syntheticDemoEnabled()) return false
  const session = getSession()
  if (!session) return false
  try {
    const sets: string[] = []
    const params: Record<string, unknown> = { entityId }
    for (const [key, val] of Object.entries(props)) {
      sets.push(`n.${key} = $${key}`)
      params[key] = val
    }
    const result = await session.run(
      `MATCH (n) WHERE elementId(n) = $entityId SET ${sets.join(', ')} RETURN count(n) AS updated`,
      params,
    )
    const updated = result.records[0]?.get('updated').toNumber() ?? 0
    if (updated === 0) return false
    console.log(`[kg] 已更新实体 elementId=${entityId}:`, props)
    return updated === 1
  } catch (err) {
    console.warn('[kg] updateEntity 失败:', (err as Error).message)
    return false
  } finally {
    await session.close()
  }
}

/** 删除实体（Neo4j 节点 + 关联关系） */
export async function deleteEntity(entityId: string): Promise<boolean> {
  if (syntheticDemoEnabled()) return false
  const session = getSession()
  if (!session) return false
  try {
    const result = await session.run(
      'MATCH (n) WHERE elementId(n) = $entityId WITH n, 1 AS deleted DETACH DELETE n RETURN deleted',
      { entityId },
    )
    if (result.records.length === 0) return false
    console.log(`[kg] 已删除实体 elementId=${entityId}`)
    return true
  } catch (err) {
    console.warn('[kg] deleteEntity 失败:', (err as Error).message)
    return false
  } finally {
    await session.close()
  }
}

/** 关闭 Neo4j 连接 */
export async function closeNeo4j(): Promise<void> {
  if (driver) {
    await driver.close()
    driver = null
    connected = false
  }
}

/** 轻量验证 Neo4j 是否能真正执行查询，供后台能力状态展示。 */
export async function checkNeo4jAvailability(): Promise<{
  available: boolean
  reason: string | null
  nodes?: number
}> {
  if (syntheticDemoEnabled()) {
    return {
      available: true,
      reason: null,
      nodes: getSyntheticDemoRepository().snapshot().entityCount,
    }
  }
  const session = getSession()
  if (!session) return { available: false, reason: 'Neo4j 未配置或尚未连接' }
  try {
    const result = await session.run('MATCH (n) RETURN count(n) AS nodes')
    return {
      available: true,
      reason: null,
      nodes: result.records[0]?.get('nodes').toNumber() ?? 0,
    }
  } catch (error) {
    return { available: false, reason: `Neo4j 查询失败：${(error as Error).message}` }
  } finally {
    await session.close()
  }
}

export async function searchEntitiesWithStatus(
  question: string,
): Promise<{ results: KGPath[]; succeeded: boolean; reason?: string }> {
  if (syntheticDemoEnabled()) {
    return {
      results: getSyntheticDemoRepository().searchKnowledgeGraph(question),
      succeeded: true,
    }
  }
  const session = getSession()
  if (!session) {
    return { results: [], succeeded: false, reason: 'Neo4j 未配置或尚未连接' }
  }
  try {
    return {
      results: await searchWithSession(question, undefined, session),
      succeeded: true,
    }
  } catch (error) {
    const reason = `Neo4j 查询失败：${(error as Error).message}`
    console.warn('[kg] 问答检索失败:', reason)
    return { results: [], succeeded: false, reason }
  } finally {
    await session.close()
  }
}

export const ENTITY_CANDIDATE_CYPHER = `
MATCH (n)
WHERE any(label IN labels(n) WHERE label IN
  ['Mineral', 'Rock', 'Structure', 'TimePeriod', 'DepositType', 'Region'])
  AND n.name IS NOT NULL
  AND (
    $question CONTAINS n.name
    OR any(alias IN coalesce(n.aliases, []) WHERE $question CONTAINS alias)
  )
RETURN elementId(n) AS entityId, n.name AS name, labels(n) AS labels,
       coalesce(n.aliases, []) AS aliases
ORDER BY size(n.name) DESC, n.name
LIMIT 10
`

export async function findEntityCandidatesWithRunner(
  question: string,
  run: KgQueryRunner,
): Promise<EntityLinkCandidate[]> {
  const result = await run(ENTITY_CANDIDATE_CYPHER, { question })
  return result.records.flatMap((record) => {
    const labels = (record.get('labels') as string[] | null) ?? []
    const type = labels.find((label): label is GeoEntityType => GEO_ENTITY_TYPES.includes(label as GeoEntityType))
    const id = record.get('entityId')
    const name = record.get('name')
    if (!type || id == null || name == null) return []
    const aliasesValue = record.get('aliases')
    const aliases = Array.isArray(aliasesValue)
      ? aliasesValue.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : []
    return [{ id: String(id), name: String(name), type, aliases }]
  })
}

export async function findEntityCandidates(question: string): Promise<EntityLinkCandidate[]> {
  if (syntheticDemoEnabled()) {
    return getSyntheticDemoRepository().findEntityCandidates(question)
  }
  const session = getSession()
  if (!session) return []
  try {
    return await findEntityCandidatesWithRunner(
      question,
      (cypher, params) => session.run(cypher, params),
    )
  } catch (error) {
    console.warn('[kg] entity candidate lookup failed:', (error as Error).message)
    return []
  } finally {
    await session.close()
  }
}

/** 图谱实体统计（供 Admin 实体管理 tab，按地质实体类型分组） */
export async function getEntityStats(): Promise<{
  totalNodes: number
  byType: Record<string, number>
  list: Array<{
    entityId: string
    name: string
    type: string
    relationCount: number
    sourceDoc: string
    status: string
    synthetic?: boolean
    isMock?: boolean
  }>
}> {
  if (syntheticDemoEnabled()) {
    return getSyntheticDemoRepository().entityStats()
  }
  const session = getSession()
  if (!session) return { totalNodes: 0, byType: {}, list: [] }

  try {
    const countResult = await session.run(
      'MATCH (n) WHERE NOT n:RejectedEntity RETURN count(n) AS totalNodes'
    )
    const totalNodes = countResult.records[0]?.get('totalNodes').toNumber() ?? 0
    const result = await session.run(`
      MATCH (n)
      WHERE any(label IN labels(n) WHERE label IN
        ['Mineral', 'Rock', 'Structure', 'TimePeriod', 'DepositType', 'Region'])
      OPTIONAL MATCH (n)-[r]-(other)
      WHERE NOT other:RejectedEntity
      WITH n, count(DISTINCT r) AS relCount
      OPTIONAL MATCH (d:Document)-[:REFERENCES]->(n)
      RETURN elementId(n) AS entityId, labels(n) AS labels, n.name AS name,
             relCount, head(collect(DISTINCT d.title)) AS sourceDoc,
             coalesce(n.status, 'verified') AS status
      ORDER BY relCount DESC
      LIMIT 100
    `)

    const list: any[] = []
    const byType: Record<string, number> = {}
    for (const record of result.records) {
      const labels: string[] = record.get('labels')
      const name: string = record.get('name') || '未知'
      const relCount: number = record.get('relCount').toNumber()
      const type = labels[0] || 'Unknown'
      const sourceDoc: string = record.get('sourceDoc') || '—'

      byType[type] = (byType[type] || 0) + 1
      list.push({
        entityId: record.get('entityId'),
        name,
        type,
        relationCount: relCount,
        sourceDoc,
        status: record.get('status'),
      })
    }

    return {
      totalNodes,
      byType,
      list,
    }
  } catch (err) {
    console.warn('[kg] 实体统计失败:', (err as Error).message)
    return { totalNodes: 0, byType: {}, list: [] }
  } finally {
    await session.close()
  }
}
