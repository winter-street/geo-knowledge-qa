import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSyntheticDemoRepository } from './synthetic-demo.js'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const repository = createSyntheticDemoRepository(path.join(repositoryRoot, 'demo', 'generated'))

assert.equal(repository.snapshot().documentCount, 6)

const search = repository.searchDocuments('Synthetic Aurora Deposit 1', 20, 'tfidf')
assert.equal(search.succeeded, true)
assert.equal(search.results.length > 0, true)
assert.equal(search.results[0]?.chunk.docType, 'synthetic')

const paths = repository.searchKnowledgeGraph('Synthetic Aurora Deposit 1 controlled')
assert.equal(paths.length > 0, true)
assert.equal(paths.every((item) => item.isMock && item.synthetic), true)

const candidates = repository.findEntityCandidates('Inspect Synthetic Aurora Deposit 1')
assert.equal(candidates[0]?.id, 'SYN-MINERAL-01')
assert.equal(repository.getEntityDetail('SYN-MINERAL-01')?.synthetic, true)

const subgraph = repository.getSubgraph('Synthetic Aurora Deposit 1')
assert.equal(subgraph.nodes.length > 0, true)
assert.equal(subgraph.nodes.every((item) => item.isMock && item.synthetic), true)
assert.equal(subgraph.edges.every((item) => item.isMock && item.synthetic), true)

const spatial = repository.getSpatialData('Synthetic Aurora Deposit 1 nearby')
assert.equal(spatial.markers.length > 0, true)
assert.equal(spatial.markers.every((item) => item.isMock && item.synthetic), true)
assert.equal(spatial.polylines.every((item) => item.isMock && item.synthetic), true)

console.log('[PASS] standalone synthetic demo repository')
