import assert from 'node:assert/strict'
import { executeToolCalls } from './executor.js'
import { createAgentRuntimeToolRegistry } from './runtime.js'

let executedMode: 'bge' | 'tfidf' | undefined
let rerankCalls = 0
const evidenceTexts = [
  'fault control evidence',
  'granite host evidence',
  'alteration halo evidence',
  'mineral age evidence',
  'regional structure evidence',
  'quartz vein evidence',
  'magnetic anomaly evidence',
  'copper grade evidence',
  'intrusive contact evidence',
  'hydrothermal fluid evidence',
  'fold geometry evidence',
  'stratigraphic boundary evidence',
  'sulfide assemblage evidence',
  'weathering profile evidence',
  'drill core evidence',
  'isotope chronology evidence',
  'remote sensing evidence',
  'gravity anomaly evidence',
  'fluid inclusion evidence',
  'prospecting target evidence',
]
const registry = createAgentRuntimeToolRegistry({
  async search(query, topK, mode) {
    assert.equal(query, 'synthetic geology')
    assert.equal(topK, 20)
    executedMode = mode
    return {
      results: Array.from({ length: 20 }, (_, index) => ({
        chunk: {
          id: index + 1,
          content: evidenceTexts[index]!,
          docTitle: index < 5 ? 'Synthetic A' : `Synthetic ${index + 1}`,
          page: index + 1,
          docType: 'synthetic',
        },
        score: 0.8 - index / 100,
      })),
      mode,
      succeeded: true,
    }
  },
  async rerank(_query, candidates, topK) {
    rerankCalls += 1
    assert.equal(topK, 20)
    return {
      results: candidates.map((item) => ({ ...item, score: 0.99 })),
      status: { mode: 'bge-reranker' as const },
    }
  },
  async searchEntities() {
    return { results: [], succeeded: true }
  },
  async spatialQuery() {
    return { data: { markers: [], polylines: [] }, source: 'none' as const, analysis: undefined }
  },
  async getEntityDetail() {
    return null
  },
})

const result = await executeToolCalls([{
  id: 'documents',
  label: 'Documents',
  tool: 'search_documents',
  args: { query: 'synthetic geology', topK: 7, retrievalMode: 'tfidf' },
}], registry)

assert.equal(result.trace[0]?.argumentSummary.retrievalMode, 'tfidf')
assert.equal(executedMode, 'tfidf', 'the audited retrieval mode must be the mode actually executed')
assert.equal(rerankCalls, 1)
const evidence = (result.results[0]?.output as {
  results: Array<{ chunk: { docTitle: string }; score: number }>
}).results
assert.equal(evidence.length, 5)
assert.equal(evidence.filter((item) => item.chunk.docTitle === 'Synthetic A').length, 2)
assert.equal(evidence[0]?.score, 0.99)

console.log('[PASS] Agent document search audit matches executed retrieval mode')
