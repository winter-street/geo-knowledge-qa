import assert from 'node:assert/strict'
import {
  COMBINED_KG_CYPHER,
  queryKgCandidates,
  type KgQueryRunner,
} from './kg.js'

function fakeRecord(values: Record<string, unknown>) {
  return {
    get(key: string) {
      return values[key]
    },
  }
}

let calls = 0
const run: KgQueryRunner = async (cypher, params) => {
  calls += 1
  assert.equal(cypher, COMBINED_KG_CYPHER)
  assert.match(cypher, /'direct' AS candidateKind,[\s\S]*?1 AS candidatePriority/)
  assert.match(cypher, /'region' AS candidateKind,[\s\S]*?0 AS candidatePriority/)
  assert.deepEqual(params.relationIntents, ['CONTROLLED_BY'])
  assert.ok((params.regionTerms as string[]).includes('攀西'))
  return {
    records: [fakeRecord({
      from: '攀枝花钒钛磁铁矿',
      relationType: 'CONTROLLED_BY',
      to: '攀枝花南北向断裂',
      candidateKind: 'region',
      regionContext: '攀西钒钛成矿带',
      inferred: false,
      isMock: true,
      source: 'spatial-demo-v1',
      fromOwlTypes: [],
      toOwlTypes: [],
      fromLng: null,
      fromLat: null,
      toLng: null,
      toLat: null,
    })],
  }
}

const rows = await queryKgCandidates(
  '攀西钒钛磁铁矿受什么构造控制',
  undefined,
  run,
)

assert.equal(calls, 1)
assert.equal(rows.length, 1)
assert.equal(rows[0]?.relation, '受控于')
assert.equal(rows[0]?.relationType, 'CONTROLLED_BY')
assert.equal(rows[0]?.regionContext, '攀西钒钛成矿带')
assert.equal(rows[0]?.isMock, true)
assert.equal(rows[0]?.source, 'spatial-demo-v1')

console.log('[PASS] combined KG query uses one database round trip')
