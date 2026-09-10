import type { AgentIntent } from '../../types/index.js'

export interface IntentContext {
  hasActiveEntities?: boolean
}

const CHITCHAT_PATTERN = /^(?:你好|您好|嗨|哈喽|早上好|下午好|晚上好|在吗|谢谢|感谢)(?:[，,。！？!?\s].*)?$/
const SPATIAL_PATTERN = /附近|周边|周围|距离|公里|千米|范围|半径|坐标|方圆|缓冲/
const COMPARISON_PATTERN = /比较|对比|差异|区别|哪个.*(?:多|少|好|强)|(?:东|西|南|北|不同).*区/
const ENTITY_LOOKUP_PATTERN = /实体详情|实体信息|介绍.*(?:实体|矿床|矿产|岩石|断裂)|(?:详情|属性|资料)$/
const DEICTIC_PATTERN = /^(?:它|它呢|这个|那个|上述|刚才的?)(?:[？?。！!，,\s]*)$/

export function classifyAgentIntent(question: string, context: IntentContext = {}): AgentIntent {
  const normalized = question.trim()

  if (!context.hasActiveEntities && DEICTIC_PATTERN.test(normalized)) return 'clarification'
  if (CHITCHAT_PATTERN.test(normalized)) return 'chitchat'
  if (COMPARISON_PATTERN.test(normalized)) return 'region_comparison'
  if (SPATIAL_PATTERN.test(normalized)) return 'spatial_analysis'
  if (ENTITY_LOOKUP_PATTERN.test(normalized)) return 'entity_lookup'
  return 'geology_qa'
}
