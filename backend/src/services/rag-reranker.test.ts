import assert from 'node:assert/strict'
import type { Chunk, KGPath } from '../types/index.js'
import { rerankRagResults } from './rag-reranker.js'

function rag(id: number, content: string, score: number) {
  const chunk: Chunk = {
    id,
    content,
    docTitle: `文档${id}`,
    page: 1,
    docType: '地质',
  }
  return { chunk, score }
}

const kgPath: KGPath = {
  from: '攀枝花钒钛磁铁矿',
  relation: '受控于',
  relationType: 'CONTROLLED_BY',
  to: '攀枝花南北向断裂',
  regionContext: '攀西钒钛成矿带',
  isMock: true,
  source: 'spatial-demo-v1',
}

const source = [
  rag(1, '普通磁铁矿概述', 0.80),
  rag(2, '攀枝花钒钛磁铁矿受攀枝花南北向断裂控制', 0.76),
  rag(3, '医学内容包含攀枝花', 0.02),
]

const reranked = rerankRagResults(
  '攀西钒钛磁铁矿受什么构造控制',
  source,
  [kgPath],
  2,
)

assert.deepEqual(reranked.map((item) => item.chunk.id), [2, 1])
assert.equal(reranked.some((item) => item.chunk.id === 3), false)
assert.equal(reranked[0]?.kgSupport, 1)
assert.ok((reranked[0]?.finalScore ?? 0) > (reranked[1]?.finalScore ?? 0))

const unchanged = rerankRagResults('磁铁矿', source.slice(0, 2), [], 5)
assert.deepEqual(unchanged.map((item) => item.chunk.id), [1, 2])
assert.deepEqual(unchanged.map((item) => item.score), [0.80, 0.76])

const belowThreshold = rerankRagResults(
  '攀枝花钒钛磁铁矿',
  [rag(1, '高相关地质资料', 0.8), rag(2, '攀枝花钒钛磁铁矿', 0.2)],
  [kgPath],
  5,
)
assert.deepEqual(belowThreshold.map((item) => item.chunk.id), [1])

console.log('[PASS] KG-aware BGE reranking and semantic threshold')
