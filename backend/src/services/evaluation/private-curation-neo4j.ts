import neo4j from 'neo4j-driver'
import type { CurationDocument, PrivateEvidencePack } from './private-curation.js'
import type { PrivateGraphExport, PrivateGraphEvidence } from './private-curation-io.js'

const ENTITY_LABELS = ['Mineral', 'Rock', 'Structure', 'TimePeriod', 'DepositType', 'Region'] as const
const RELATION_TYPES = [
  'HOSTED_IN', 'CONTROLLED_BY', 'FORMED_IN', 'BELONGS_TO',
  'LIES_IN', 'ASSOCIATED_WITH', 'CUTS',
] as const

export type PrivateNeo4jRow = Record<string, unknown>
export type PrivateNeo4jQuery = (
  cypher: string,
  parameters?: Record<string, unknown>,
) => Promise<PrivateNeo4jRow[]>

interface PrivateNeo4jConnection {
  query: PrivateNeo4jQuery
  close: () => Promise<void>
}

function finiteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (neo4j.isInt(value)) return value.toNumber()
  throw new Error('Neo4j snapshot returned a non-numeric count.')
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function entityType(value: unknown): PrivateEvidencePack['entities'][number]['type'] | undefined {
  return ENTITY_LABELS.find((label) => label === value)
}

function evidenceEntry(map: Map<number, PrivateGraphEvidence>, documentId: number): PrivateGraphEvidence {
  const current = map.get(documentId)
  if (current) return current
  const created: PrivateGraphEvidence = { entities: [], kgPaths: [], spatialEligible: false }
  map.set(documentId, created)
  return created
}

export async function collectPrivateGraphExport(input: {
  documents: CurationDocument[]
  query: PrivateNeo4jQuery
}): Promise<PrivateGraphExport> {
  const documentKeys = input.documents.map((document) => ({ documentId: document.id, title: document.title }))
  const labels = [...ENTITY_LABELS]
  const relations = [...RELATION_TYPES]
  const counts = (await input.query(`
    CALL { MATCH (n) RETURN count(n) AS nodeCount }
    CALL { MATCH ()-[r]->() RETURN count(r) AS relationshipCount }
    RETURN nodeCount, relationshipCount
  `))[0]
  if (!counts) throw new Error('Neo4j snapshot did not return graph counts.')
  const ids = (await input.query(`
    MATCH (n)
    WHERE any(label IN labels(n) WHERE label IN $labels)
    RETURN collect(elementId(n)) AS entityIds
  `, { labels }))[0]
  if (!ids) throw new Error('Neo4j snapshot did not return entity IDs.')

  const evidenceByDocumentId = new Map<number, PrivateGraphEvidence>()
  const entityRows = await input.query(`
    UNWIND $documents AS source
    MATCH (d:Document {title: source.title})-[:REFERENCES]->(seed)
    OPTIONAL MATCH (seed)-[connected]-(neighbor)
    WHERE type(connected) IN $relations
    WITH source, seed, collect(neighbor) AS neighbors
    UNWIND [seed] + neighbors AS entity
    WITH source, entity
    WHERE any(label IN labels(entity) WHERE label IN $labels)
    RETURN DISTINCT source.documentId AS documentId,
           elementId(entity) AS entityId,
           entity.name AS name,
           head([label IN labels(entity) WHERE label IN $labels]) AS type,
           (entity.privateEvaluationEligible = true AND
             ((entity.longitude IS NOT NULL AND entity.latitude IS NOT NULL)
             OR (entity.lon IS NOT NULL AND entity.lat IS NOT NULL))) AS spatialEligible
  `, { documents: documentKeys, labels, relations })
  for (const row of entityRows) {
    const documentId = finiteNumber(row.documentId)
    const type = entityType(row.type)
    if (typeof row.entityId !== 'string' || typeof row.name !== 'string' || !type) continue
    const entry = evidenceEntry(evidenceByDocumentId, documentId)
    if (!entry.entities.some((entity) => entity.entityId === row.entityId)) {
      entry.entities.push({ entityId: row.entityId, name: row.name, type })
    }
    entry.spatialEligible ||= row.spatialEligible === true
  }

  const pathRows = await input.query(`
    UNWIND $documents AS source
    MATCH (d:Document {title: source.title})-[:REFERENCES]->(seed)
    MATCH (from)-[relation]->(to)
    WHERE type(relation) IN $relations
      AND (from = seed OR to = seed)
      AND any(label IN labels(from) WHERE label IN $labels)
      AND any(label IN labels(to) WHERE label IN $labels)
    RETURN DISTINCT source.documentId AS documentId,
           elementId(from) AS fromId,
           type(relation) AS relation,
           elementId(to) AS toId
  `, { documents: documentKeys, labels, relations })
  for (const row of pathRows) {
    const documentId = finiteNumber(row.documentId)
    if (typeof row.fromId !== 'string' || typeof row.relation !== 'string' || typeof row.toId !== 'string') continue
    const entry = evidenceEntry(evidenceByDocumentId, documentId)
    if (!entry.kgPaths.some((path) =>
      path.fromId === row.fromId && path.relation === row.relation && path.toId === row.toId)) {
      entry.kgPaths.push({ fromId: row.fromId, relation: row.relation, toId: row.toId })
    }
  }

  return {
    snapshot: {
      available: true,
      nodeCount: finiteNumber(counts.nodeCount),
      relationshipCount: finiteNumber(counts.relationshipCount),
      entityIds: strings(ids.entityIds),
    },
    evidenceByDocumentId,
  }
}

function defaultConnect(input: { uri: string; user: string; password: string }): PrivateNeo4jConnection {
  const driver = neo4j.driver(input.uri, neo4j.auth.basic(input.user, input.password))
  return {
    query: async (cypher, parameters = {}) => {
      const result = await driver.executeQuery(cypher, parameters)
      return result.records.map((record) => record.toObject())
    },
    close: () => driver.close(),
  }
}

export function createPrivateNeo4jGraphProvider(input: {
  uri: string
  user: string
  password: string
  documents: CurationDocument[]
  connect?: (settings: { uri: string; user: string; password: string }) => PrivateNeo4jConnection
}): () => Promise<PrivateGraphExport> {
  return async () => {
    const connection = (input.connect ?? defaultConnect)({
      uri: input.uri,
      user: input.user,
      password: input.password,
    })
    try {
      return await collectPrivateGraphExport({ documents: input.documents, query: connection.query })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Neo4j private snapshot failed: ${message}`)
    } finally {
      await connection.close()
    }
  }
}
