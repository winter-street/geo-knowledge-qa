import { describe, expect, it } from 'vitest'
import { formatClaimCitations } from './citations'

describe('formatClaimCitations', () => {
  it('labels sanitized document and knowledge-graph claim citations', () => {
    expect(formatClaimCitations([
      { id: 'D4-P2', label: '[D4-P2]', kind: 'document', docId: 4, page: 2 },
      { id: 'KG1', label: '[KG1]', kind: 'kg', kgPathIndex: 0 },
    ])).toEqual([
      { id: 'D4-P2', label: '[D4-P2]', detail: '文档证据' },
      { id: 'KG1', label: '[KG1]', detail: '图谱关系' },
    ])
  })

  it('accepts missing citations from older servers', () => {
    expect(formatClaimCitations()).toEqual([])
  })
})
