import assert from 'node:assert/strict'
import type { Chunk } from '../types/index.js'
import type { RetrievalPolicy } from './retrieval-policy.js'
import {
  finalizeRetrievalResults,
  ragCandidateTopK,
} from './retrieval-fusion.js'

function rag(id: number, score: number) {
  const chunk: Chunk = {
    id,
    content: `地质片段${id}`,
    docTitle: `文档${id}`,
    page: 1,
    docType: '地质',
  }
  return { chunk, score }
}

const hybrid: RetrievalPolicy = {
  useRag: true,
  useKg: true,
  useSpatial: true,
  ragMode: 'bge',
  ragTopK: 5,
  ragWeight: 0.5,
  kgWeight: 0.3,
  spatialWeight: 0.2,
}

assert.equal(ragCandidateTopK(hybrid), 20)
assert.equal(ragCandidateTopK({ ...hybrid, ragTopK: 10 }), 20)
assert.equal(ragCandidateTopK({ ...hybrid, useRag: false }), 0)

const candidates = Array.from({ length: 15 }, (_item, index) =>
  rag(index + 1, 0.9 - index * 0.02),
)
const hybridResults = finalizeRetrievalResults(
  '地质问题',
  candidates,
  [],
  hybrid,
)
assert.equal(hybridResults.length, 5)
assert.deepEqual(hybridResults.map((item) => item.chunk.id), [1, 2, 3, 4, 5])

const ragOnly = finalizeRetrievalResults(
  '地质问题',
  candidates,
  [],
  { ...hybrid, useKg: false },
)
assert.deepEqual(ragOnly.map((item) => item.chunk.id), [1, 2, 3, 4, 5])

const kgOnly = finalizeRetrievalResults(
  '地质问题',
  candidates,
  [],
  { ...hybrid, useRag: false },
)
assert.deepEqual(kgOnly, [])

console.log('[PASS] retrieval expansion and fusion orchestration')
