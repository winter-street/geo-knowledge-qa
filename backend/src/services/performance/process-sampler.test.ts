import assert from 'node:assert/strict'
import { createWindowsProcessSampler } from './process-sampler.js'

let now = 0
let cpuTime = 1_000
const sampler = createWindowsProcessSampler([{ name: 'backend', pid: 42 }], {
  now: () => now,
  logicalProcessors: 4,
  commandRunner: async () => [{ Id: 42, WorkingSet64: 100_000, TotalProcessorTimeMs: cpuTime }],
})
const first = await sampler.sample()
assert.equal(first[0]?.available, true)
assert.equal(first[0]?.cpuPercent, undefined)

now = 1_000
cpuTime = 1_200
const second = await sampler.sample()
assert.equal(second[0]?.cpuPercent, 5)
assert.equal(second[0]?.workingSetBytes, 100_000)

console.log('[PASS] Windows process resource sampler')
