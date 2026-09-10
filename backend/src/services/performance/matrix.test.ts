import assert from 'node:assert/strict'
import { PERFORMANCE_MODES } from './types.js'
import { buildEvaluationMatrix } from './matrix.js'

const matrix = buildEvaluationMatrix([{ id: 'case-1', kind: 'supported', question: 'demo' }])
assert.deepEqual(matrix.map((item) => item.mode), [...PERFORMANCE_MODES])
assert.equal(new Set(matrix.map((item) => item.id)).size, 1)
assert.equal(matrix.length, 5)
assert.throws(
  () => buildEvaluationMatrix([{ id: 'case-1', kind: 'supported', question: 'demo' }], ['direct', 'direct']),
  /duplicate/i,
)

console.log('[PASS] performance evaluation matrix')
