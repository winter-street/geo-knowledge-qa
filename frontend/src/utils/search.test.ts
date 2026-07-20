import { describe, it, expect } from 'vitest'
import { filterConversations } from './search'

describe('filterConversations', () => {
  const conversations = [
    { id: '1', title: '钒钛磁铁矿成因类型', createdAt: '2026-07-01' },
    { id: '2', title: '尾亚断裂带控制特征', createdAt: '2026-07-02' },
    { id: '3', title: '新对话', createdAt: '2026-07-03' },
  ]

  it('returns all conversations when query is empty', () => {
    expect(filterConversations(conversations, '')).toEqual(conversations)
    expect(filterConversations(conversations, '  ')).toEqual(conversations)
  })

  it('filters by title fuzzy match', () => {
    const result = filterConversations(conversations, '钒钛')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('matches partial characters', () => {
    const result = filterConversations(conversations, '断裂')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('2')
  })

  it('returns empty array when no match', () => {
    expect(filterConversations(conversations, '煤矿')).toEqual([])
  })

  it('is case-insensitive for English', () => {
    const enConvs = [
      { id: '1', title: 'Hello World', createdAt: '' },
      { id: '2', title: 'hello world', createdAt: '' },
    ]
    expect(filterConversations(enConvs, 'hello')).toHaveLength(2)
  })

  it('handles empty conversations array', () => {
    expect(filterConversations([], 'test')).toEqual([])
  })
})
