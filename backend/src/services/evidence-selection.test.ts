import assert from 'node:assert/strict'
import type { Chunk } from '../types/index.js'
import { selectDiverseEvidence } from './evidence-selection.js'

function item(id: number, docTitle: string, content: string, score: number) {
  const chunk: Chunk = { id, docTitle, content, page: id, docType: 'synthetic' }
  return { chunk, score }
}

const selected = selectDiverseEvidence([
  item(1, 'Synthetic A', '北东向断裂控制铜矿热液活动。', 0.99),
  item(2, 'Synthetic A', '北东向断裂 控制 铜矿热液活动', 0.98),
  item(3, 'Synthetic A', '花岗岩体提供成矿热源。', 0.97),
  item(4, 'Synthetic A', '接触带发育矽卡岩。', 0.96),
  item(5, 'Synthetic B', '铜矿体沿构造交汇处分布。', 0.95),
  item(6, 'Synthetic B', '围岩蚀变以硅化为主。', 0.94),
  item(7, 'Synthetic C', '成矿时代为燕山期。', 0.93),
  item(8, 'Synthetic D', '磁铁矿与辉长岩相关。', 0.92),
], 5)

assert.equal(selected.length, 5)
assert.equal(selected.filter((entry) => entry.chunk.docTitle === 'Synthetic A').length, 2)
assert.equal(selected.filter((entry) => entry.chunk.docTitle === 'Synthetic B').length, 2)
assert.equal(selected.some((entry) => entry.chunk.id === 2), false, 'near duplicate must be removed')
assert.deepEqual(selected.map((entry) => entry.chunk.id), [1, 3, 5, 6, 7])

console.log('[PASS] evidence deduplication and per-document diversity')
