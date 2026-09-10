import assert from 'node:assert/strict'
import type { Chunk } from '../types/index.js'
import { rerankDocuments } from './reranker-client.js'

const candidates = Array.from({ length: 20 }, (_, index) => index + 1).map((id) => ({
  chunk: {
    id,
    content: `Synthetic evidence ${id}`,
    docTitle: `Synthetic ${id}`,
    page: id,
    docType: 'synthetic',
  } satisfies Chunk,
  score: 1 - id / 10,
}))

let requestedTopK = 0
const success = await rerankDocuments('synthetic question', candidates, 20, async (_input, init) => {
  requestedTopK = JSON.parse(String(init?.body)).top_k
  return new Response(JSON.stringify({
    chunks: [...candidates].reverse().map((entry, index) => ({
      id: entry.chunk.id,
      rerank_score: 1 - index / 100,
    })),
    rerank: { status: 'applied', mode: 'bge-reranker-base', model: 'BAAI/bge-reranker-base' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
assert.equal(success.status.mode, 'bge-reranker')
assert.equal(requestedTopK, 20)
assert.equal(success.results.length, 20)
assert.deepEqual(success.results.slice(0, 3).map((entry) => entry.chunk.id), [20, 19, 18])

const fallback = await rerankDocuments('synthetic question', candidates, 20, async () => new Response(JSON.stringify({
  chunks: candidates.map((entry) => ({ id: entry.chunk.id })),
  rerank: { status: 'fallback', mode: 'original-order', reason: 'model_disabled' },
}), { status: 200, headers: { 'Content-Type': 'application/json' } }))
assert.equal(fallback.status.mode, 'fallback')
assert.deepEqual(
  fallback.results.map((entry) => entry.chunk.id),
  candidates.map((entry) => entry.chunk.id),
)

const overflowFallback = await rerankDocuments('synthetic question', [
  ...candidates,
  {
    chunk: {
      id: 21,
      content: 'Synthetic overflow evidence',
      docTitle: 'Synthetic overflow',
      page: 21,
      docType: 'synthetic',
    } satisfies Chunk,
    score: 0.1,
  },
], 20, async () => new Response(null, { status: 503 }))
assert.equal(overflowFallback.results.length, 20)

console.log('[PASS] optional BGE reranker client and deterministic fallback')
