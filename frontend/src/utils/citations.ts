import type { AgentCitation } from '@/types'

export interface DisplayCitation {
  id: string
  label: string
  detail: '文档证据' | '图谱关系'
}

export function formatClaimCitations(citations?: AgentCitation[]): DisplayCitation[] {
  return (citations ?? []).map((citation) => ({
    id: citation.id,
    label: citation.label,
    detail: citation.kind === 'document' ? '文档证据' : '图谱关系',
  }))
}
