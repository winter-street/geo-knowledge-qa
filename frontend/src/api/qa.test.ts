import assert from 'node:assert/strict'
import { normalizeMapPlan } from './qa.js'

const validPlan = {
  id: 'plan-1',
  version: 1,
  title: '攀西空间分析',
  autoExecute: true,
  openFullMap: false,
  actions: [
    { type: 'query', question: '显示攀西钒钛磁铁矿' },
    { type: 'set-result-mode', mode: 'score' },
    { type: 'fit-bounds' },
  ],
  warnings: [],
}

assert.equal(normalizeMapPlan({ ...validPlan, version: 2 }), undefined)
assert.equal(normalizeMapPlan({ ...validPlan, actions: [{ type: 'run-script', code: 'x' }] }), undefined)
assert.equal(normalizeMapPlan({
  ...validPlan,
  actions: [{ type: 'grid-prediction', gridSizeKm: 15, minimumScore: 85 }],
}), undefined)
assert.equal(normalizeMapPlan({
  ...validPlan,
  actions: [{ type: 'buffer', radiusKm: 0 }],
}), undefined)

const normalized = normalizeMapPlan(validPlan)
assert.equal(normalized?.id, 'plan-1')
assert.deepEqual(normalized?.actions.map((action) => action.type), [
  'query', 'set-result-mode', 'fit-bounds',
])

console.log('[PASS] QA map plan parser: version and action whitelist validation')
