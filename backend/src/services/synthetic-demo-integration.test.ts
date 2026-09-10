import assert from 'node:assert/strict'

process.env.SYNTHETIC_DEMO = 'true'

const tfidf = await import('./tfidf.js')
const kg = await import('./kg.js')
const { rerankDocuments } = await import('./reranker-client.js')
const { generateAnswer } = await import('./llm.js')
const database = await import('../db/sqlite.js')

const search = await tfidf.search('Synthetic Aurora Deposit 1', 20, 'tfidf')
assert.equal(search.succeeded, true)
assert.equal(search.results[0]?.chunk.synthetic, true)
const sources = tfidf.toSources(search.results)
assert.equal(sources.every((item) => item.synthetic && item.isMock), true)
const reranked = await rerankDocuments(
  'Synthetic Aurora Deposit 1',
  search.results,
  20,
  async () => { throw new Error('synthetic demo must not call Flask reranker') },
)
assert.equal(reranked.status.reason, 'synthetic demo deterministic order')

const paths = await kg.searchEntities('Synthetic Aurora Deposit 1')
assert.equal(paths.length > 0, true)
assert.equal(paths.every((item) => item.synthetic && item.isMock), true)

const status = await kg.searchEntitiesWithStatus('Synthetic Aurora Deposit 1')
assert.equal(status.succeeded, true)
assert.equal(status.results.length > 0, true)

const generated = await generateAnswer('Synthetic Aurora Deposit 1', search.results, paths)
assert.equal(generated.sources.every((item) => item.synthetic && item.isMock), true)

const candidates = await kg.findEntityCandidates('Inspect Synthetic Aurora Deposit 1')
assert.equal(candidates[0]?.id, 'SYN-MINERAL-01')

const detail = await kg.getEntityDetail('SYN-MINERAL-01')
assert.equal(detail?.synthetic, true)

const subgraph = await kg.getSubgraph('Synthetic Aurora Deposit 1')
assert.equal(subgraph.nodes.every((item) => item.synthetic && item.isMock), true)
assert.equal(subgraph.edges.every((item) => item.synthetic && item.isMock), true)

const spatial = await kg.getSpatialResults('Synthetic Aurora Deposit 1 nearby')
assert.equal(spatial.markers.length > 0, true)
assert.equal(spatial.markers.every((item) => item.synthetic && item.isMock), true)

const stats = await kg.getEntityStats()
assert.equal(stats.totalNodes, 30)
assert.equal(stats.list.every((item) => item.synthetic && item.isMock), true)

const databaseStats = database.getStats()
assert.deepEqual(
  { docCount: databaseStats.docCount, chunkCount: databaseStats.chunkCount },
  { docCount: 6, chunkCount: 6 },
)
assert.equal(Number.isInteger(databaseStats.logCount) && databaseStats.logCount >= 0, true)
assert.equal(database.getDocs().length, 6)
assert.equal(database.getDocs().every((item) => item.docType === 'synthetic'), true)

console.log('[PASS] synthetic demo service integration')
