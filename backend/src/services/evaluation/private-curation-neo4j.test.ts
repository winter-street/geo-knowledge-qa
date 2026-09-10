import assert from 'node:assert/strict'
import {
  collectPrivateGraphExport,
  createPrivateNeo4jGraphProvider,
  type PrivateNeo4jQuery,
} from './private-curation-neo4j.js'

const documents = [
  { id: 7, title: 'SECRET_DOCUMENT_TITLE', docType: 'report', totalPages: 2 },
]

const queries: Array<{ cypher: string; parameters: Record<string, unknown> }> = []
const query: PrivateNeo4jQuery = async (cypher, parameters = {}) => {
  queries.push({ cypher, parameters })
  if (cypher.includes('nodeCount')) return [{ nodeCount: 5, relationshipCount: 3 }]
  if (cypher.includes('entityIds')) return [{ entityIds: ['4:entity-a', '4:entity-b'] }]
  if (cypher.includes('entityId')) {
    return [{
      documentId: 7,
      entityId: '4:entity-a',
      name: '测试矿物',
      type: 'Mineral',
      spatialEligible: true,
    }, {
      documentId: 7,
      entityId: '4:entity-b',
      name: '测试断裂',
      type: 'Structure',
      spatialEligible: false,
    }]
  }
  return [{
    documentId: 7,
    fromId: '4:entity-a',
    relation: 'CONTROLLED_BY',
    toId: '4:entity-b',
  }]
}

const graph = await collectPrivateGraphExport({ documents, query })
assert.deepEqual(graph.snapshot, {
  available: true,
  nodeCount: 5,
  relationshipCount: 3,
  entityIds: ['4:entity-a', '4:entity-b'],
})
assert.deepEqual(graph.evidenceByDocumentId.get(7), {
  entities: [
    { entityId: '4:entity-a', name: '测试矿物', type: 'Mineral' },
    { entityId: '4:entity-b', name: '测试断裂', type: 'Structure' },
  ],
  kgPaths: [{ fromId: '4:entity-a', relation: 'CONTROLLED_BY', toId: '4:entity-b' }],
  spatialEligible: true,
})
assert.equal(JSON.stringify(graph).includes('SECRET_DOCUMENT_TITLE'), false)
assert.equal(JSON.stringify(graph).match(/longitude|latitude|coordinates/i), null)
assert.equal(queries.some((item) => JSON.stringify(item.parameters).includes('SECRET_DOCUMENT_TITLE')), true)
assert.equal(queries.some((item) => item.cypher.includes('from = seed OR to = seed')), true)
assert.equal(queries.some((item) => item.cypher.includes('privateEvaluationEligible = true')), true)
assert.equal(queries.some((item) => item.cypher.includes('entity.lat IS NOT NULL))) AS spatialEligible')), true)

let closed = false
const provider = createPrivateNeo4jGraphProvider({
  uri: 'bolt://private.invalid:7687',
  user: 'neo4j',
  password: 'secret',
  documents,
  connect: () => ({
    query: async () => { throw new Error('connection refused') },
    close: async () => { closed = true },
  }),
})
await assert.rejects(provider, /Neo4j private snapshot failed: connection refused/)
assert.equal(closed, true, 'driver must close after a failed snapshot')

console.log('[PASS] private Neo4j snapshot export and failure boundary')
