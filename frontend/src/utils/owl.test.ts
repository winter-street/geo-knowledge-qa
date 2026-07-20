import assert from 'node:assert/strict'
import { formatEvidenceEntities, summarizeOwlEvidence } from './owl'

const summary = summarizeOwlEvidence([
  {
    from: '磁铁矿', relation: '受控于', to: '断裂带',
    fromOwlTypes: ['StructurallyControlledMineral', 'RockHostedMineral'],
  },
  {
    from: '方铅矿', relation: '受控于', to: '断裂带',
    fromOwlTypes: ['StructurallyControlledMineral'],
  },
])

assert.equal(summary.length, 2)
assert.equal(summary[0]?.label, '赋存岩石')
assert.deepEqual(new Set(summary[1]?.entities), new Set(['方铅矿', '磁铁矿']))
assert.equal(formatEvidenceEntities(['甲', '乙', '丙'], 2), '甲、乙等 3 项')

console.log('owl utils assertions passed')
