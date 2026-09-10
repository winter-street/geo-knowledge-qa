import assert from 'node:assert/strict'
import { parsePerformanceArgs } from './cli.js'

assert.equal(parsePerformanceArgs(['--help']).command, 'help')
assert.equal(parsePerformanceArgs(['smoke']).profile, 'smoke')
assert.equal(parsePerformanceArgs(['local', '--profile', 'formal']).profile, 'formal')
assert.throws(() => parsePerformanceArgs(['unknown']), /unknown performance command/i)
assert.throws(() => parsePerformanceArgs(['real', '--suite', 'private.json']), /confirm-real-api/i)
assert.throws(() => parsePerformanceArgs(['report']), /requires --run/i)

console.log('[PASS] performance CLI contract')
