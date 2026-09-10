import assert from 'node:assert/strict'
import { findEntityCandidatesWithRunner } from './kg.js'

let receivedQuestion = ''
const candidates = await findEntityCandidatesWithRunner('Demo Deposit details', async (_cypher, params) => {
  receivedQuestion = String(params.question)
  return {
    records: [{
      get(key: string) {
        return {
          entityId: 'node-1',
          name: 'Demo Deposit',
          labels: ['Mineral'],
          aliases: ['Deposit A'],
        }[key]
      },
    }],
  }
})

assert.equal(receivedQuestion, 'Demo Deposit details')
assert.deepEqual(candidates, [{
  id: 'node-1',
  name: 'Demo Deposit',
  type: 'Mineral',
  aliases: ['Deposit A'],
}])

console.log('[PASS] privacy-safe KG entity candidate lookup')
