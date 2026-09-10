import assert from 'node:assert/strict'
import { bootstrapDifference, percentile } from './statistics.js'

assert.equal(percentile([10, 20, 30, 40], 0.5), 20)
assert.equal(percentile([10, 20, 30, 40], 0.95), 40)
assert.equal(percentile([], 0.95), 0)
assert.throws(() => percentile([1], 1.1), /between 0 and 1/i)

const first = bootstrapDifference([0.7, 0.8, 0.9], [0.4, 0.5, 0.6], { iterations: 500, seed: 7 })
const second = bootstrapDifference([0.7, 0.8, 0.9], [0.4, 0.5, 0.6], { iterations: 500, seed: 7 })
assert.deepEqual(first, second)
assert.equal(first.meanDifference, 0.3)
assert.ok(first.lower > 0)

console.log('[PASS] performance statistics')
