import assert from 'node:assert/strict'
import { runLoadScenario } from './load-runner.js'

let clock = 0
const activeByWorker = new Map<number, number>()
const maxByWorker = new Map<number, number>()
const result = await runLoadScenario({
  runId: 'run-1',
  scenario: 'agent-json',
  concurrency: 2,
  questions: [{ id: 'case-1', question: 'demo' }],
  warmupMs: 4,
  durationMs: 12,
  now: () => clock,
}, async (workerId) => ({
  async execute(request) {
    const active = (activeByWorker.get(workerId) ?? 0) + 1
    activeByWorker.set(workerId, active)
    maxByWorker.set(workerId, Math.max(maxByWorker.get(workerId) ?? 0, active))
    clock += 2
    activeByWorker.set(workerId, active - 1)
    return {
      runId: request.runId,
      requestId: request.requestId,
      caseId: request.caseId,
      mode: 'agent',
      status: 'success',
      totalMs: 2,
      retrievedDocumentIds: [],
      citationIds: [],
      selectedTools: [],
    }
  },
}))

assert.equal(result.concurrency, 2)
assert.ok(result.warmupRequestCount > 0)
assert.ok(result.observations.length > 0)
assert.deepEqual([...maxByWorker.values()], [1, 1])
assert.equal(new Set(result.observations.map((item) => item.requestId)).size, result.observations.length)

console.log('[PASS] closed-concurrency performance load runner')
