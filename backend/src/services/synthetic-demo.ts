import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  Chunk,
  EntityLinkCandidate,
  GeoEntityType,
  KGPath,
  SpatialData,
  Subgraph,
} from '../types/index.js'
import type { RagSearchResponse } from './tfidf.js'
import type { RuntimeSettings } from './runtime-settings.js'

interface SyntheticDocument {
  id: string
  chunkId: number
  title: string
  page: number
  docType: string
  content: string
  synthetic: true
  isMock: true
}

interface SyntheticNode {
  id: string
  label: string
  name: string
  type: GeoEntityType
  aliases: string[]
  properties: Record<string, unknown>
  synthetic: true
  isMock: true
}

interface SyntheticEdge {
  id: string
  source: string
  target: string
  type: string
  label: string
  synthetic: true
  isMock: true
}

interface SyntheticGraph {
  nodes: SyntheticNode[]
  edges: SyntheticEdge[]
  paths: Array<KGPath & { synthetic: true; isMock: true }>
}

interface SyntheticDocumentsFile {
  documents: SyntheticDocument[]
}

interface SyntheticSpatialFile extends SpatialData {
  synthetic: true
  isMock: true
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

function terms(value: string): string[] {
  return normalized(value).match(/[a-z0-9]+/gu)?.filter((item) => item.length >= 2) ?? []
}

function matchesNamedValue(question: string, name: string, aliases: string[] = []): boolean {
  const query = normalized(question)
  return [name, ...aliases].some((value) => query.includes(normalized(value)))
}

function suffixOf(id: string): string | undefined {
  return id.match(/(\d{2})$/u)?.[1]
}

export function syntheticDemoEnabled(): boolean {
  return process.env.SYNTHETIC_DEMO?.trim().toLocaleLowerCase('en-US') === 'true'
}

export function createSyntheticDemoRepository(root: string) {
  const documents = readJson<SyntheticDocumentsFile>(path.join(root, 'documents.json')).documents
  const graph = readJson<SyntheticGraph>(path.join(root, 'graph.json'))
  const spatial = readJson<SyntheticSpatialFile>(path.join(root, 'spatial.json'))
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))

  return {
    snapshot() {
      return {
        synthetic: true as const,
        isMock: true as const,
        documentCount: documents.length,
        chunkCount: documents.length,
        entityCount: graph.nodes.length,
        relationCount: graph.edges.length,
        spatialFeatureCount: spatial.markers.length + spatial.polylines.length,
      }
    },

    listDocuments() {
      return documents.map((document) => ({
        docId: document.chunkId,
        title: document.title,
        docType: document.docType,
        totalPages: 1,
        chunkCount: 1,
        status: 'synthetic',
        uploadedAt: '2026-01-01T00:00:00.000Z',
      }))
    },

    getDocument(docId: number) {
      return this.listDocuments().find((document) => document.docId === docId)
    },

    getDocumentChunks(docId: number) {
      return documents.filter((document) => document.chunkId === docId).map((document) => ({
        id: document.chunkId,
        page: document.page,
        chunkIndex: 0,
        text: document.content,
        charStart: 0,
        charEnd: document.content.length,
        synthetic: true,
        isMock: true,
      }))
    },

    searchDocuments(
      question: string,
      topK: number,
      mode: RuntimeSettings['ragMode'],
    ): RagSearchResponse {
      const queryTerms = terms(question)
      const results = documents
        .map((document) => {
          const haystack = normalized(`${document.title} ${document.content}`)
          const hits = queryTerms.filter((term) => haystack.includes(term)).length
          const exactBoost = haystack.includes(normalized(question)) ? 1 : 0
          const chunk: Chunk = {
            id: document.chunkId,
            content: document.content,
            docTitle: document.title,
            page: document.page,
            docType: document.docType,
            synthetic: true,
            isMock: true,
          }
          return { chunk, score: exactBoost + (queryTerms.length ? hits / queryTerms.length : 0) }
        })
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || left.chunk.id - right.chunk.id)
        .slice(0, Math.max(0, Math.min(topK, 20)))
      return { results, mode, succeeded: true }
    },

    searchKnowledgeGraph(question: string): KGPath[] {
      const matchedNodeIds = new Set(graph.nodes
        .filter((node) => matchesNamedValue(question, node.name, node.aliases))
        .map((node) => node.id))
      const matchedNames = new Set([...matchedNodeIds].flatMap((id) => {
        const node = nodeById.get(id)
        return node ? [node.name] : []
      }))
      return graph.paths.filter((item) =>
        matchedNames.has(item.from)
        || matchedNames.has(item.to)
        || normalized(question).includes(normalized(item.relation)),
      )
    },

    findEntityCandidates(question: string): EntityLinkCandidate[] {
      return graph.nodes
        .filter((node) => matchesNamedValue(question, node.name, node.aliases))
        .map((node) => ({ id: node.id, name: node.name, type: node.type, aliases: node.aliases }))
        .sort((left, right) => right.name.length - left.name.length || left.id.localeCompare(right.id))
    },

    getEntityDetail(entityId: string): Record<string, unknown> | null {
      const node = nodeById.get(entityId)
      if (!node) return null
      return {
        entityId: node.id,
        name: node.name,
        type: node.type,
        aliases: node.aliases,
        ...node.properties,
        synthetic: true,
        isMock: true,
      }
    },

    getSubgraph(question: string): Subgraph {
      const seeds = new Set(graph.nodes
        .filter((node) => matchesNamedValue(question, node.name, node.aliases))
        .map((node) => node.id))
      const edges = graph.edges.filter((edge) => seeds.has(edge.source) || seeds.has(edge.target))
      const nodeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]))
      for (const seed of seeds) nodeIds.add(seed)
      return {
        nodes: [...nodeIds].flatMap((id) => {
          const node = nodeById.get(id)
          return node ? [{
            id: node.id,
            label: node.label,
            type: node.type,
            synthetic: true,
            isMock: true,
          }] : []
        }),
        edges: edges.map((edge) => ({
          source: edge.source,
          target: edge.target,
          label: edge.label,
          synthetic: true,
          isMock: true,
        })),
      }
    },

    getSpatialData(question: string): SpatialData {
      const markers = spatial.markers.filter((marker) => matchesNamedValue(question, marker.name))
      const suffixes = new Set(markers.flatMap((marker) => suffixOf(marker.id) ?? []))
      const polylines = spatial.polylines.filter((line) =>
        matchesNamedValue(question, line.label ?? '') || suffixes.has(suffixOf(line.id) ?? ''),
      )
      return { markers, polylines }
    },

    entityStats() {
      const byType: Record<string, number> = {}
      for (const node of graph.nodes) byType[node.type] = (byType[node.type] ?? 0) + 1
      return {
        totalNodes: graph.nodes.length,
        byType,
        list: graph.nodes.map((node) => ({
          entityId: node.id,
          name: node.name,
          type: node.type,
          relationCount: graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id).length,
          sourceDoc: String(node.properties.sourceDocumentId ?? 'synthetic-demo-v1'),
          status: 'synthetic',
          synthetic: true,
          isMock: true,
        })),
      }
    },
  }
}

let defaultRepository: ReturnType<typeof createSyntheticDemoRepository> | undefined

export function getSyntheticDemoRepository(): ReturnType<typeof createSyntheticDemoRepository> {
  defaultRepository ??= createSyntheticDemoRepository(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'demo', 'generated'),
  )
  return defaultRepository
}
