import { describe, expect, it } from 'vitest'
import { summarizeKgProvenance } from './kg-evidence'

describe('KG evidence provenance', () => {
  it('counts demo and inferred paths separately', () => {
    expect(summarizeKgProvenance([
      {
        from: 'A',
        relation: '位于',
        to: 'B',
        isMock: true,
        source: 'spatial-demo-v1',
      },
      {
        from: 'C',
        relation: '受控于',
        to: 'D',
        inferred: true,
      },
    ])).toEqual({
      mockCount: 1,
      inferredCount: 1,
      hasMock: true,
    })
  })
})
