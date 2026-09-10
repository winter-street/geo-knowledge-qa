import assert from 'node:assert/strict'
import { createRequestTiming, performanceTraceEnabled } from './timing.js'

const ticks = [0, 0, 10, 25]
const timing = createRequestTiming(true, () => ticks.shift() ?? 25, { runId: 'run-1', requestId: 'request-1' })
const result = await timing.measure('retrieval', async () => 'ok')
assert.equal(result, 'ok')
assert.equal(timing.snapshot().stages.retrieval, 10)
const diagnostics = timing.finish()
assert.equal(diagnostics.stages.total, 25)
assert.equal(diagnostics.runId, 'run-1')
assert.equal(diagnostics.requestId, 'request-1')

const disabled = createRequestTiming(false, () => 100)
await disabled.measure('llm', async () => undefined)
disabled.mark('llm', 40)
assert.deepEqual(disabled.finish(), { stages: {}, counters: {} })

assert.equal(performanceTraceEnabled('true', 'run', 'request'), true)
assert.equal(performanceTraceEnabled('true', 'run', undefined), false)
assert.equal(performanceTraceEnabled('false', 'run', 'request'), false)

console.log('[PASS] request performance timing')
