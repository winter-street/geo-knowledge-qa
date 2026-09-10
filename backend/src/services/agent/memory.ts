import type { AgentMemory, AgentMessage, LinkedEntity } from '../../types/index.js'

const MAX_RECENT_MESSAGES = 12

export function buildAgentMemory(
  messages: AgentMessage[],
  summary: string,
  activeEntities: LinkedEntity[],
): AgentMemory {
  return {
    recentMessages: messages.slice(-MAX_RECENT_MESSAGES),
    summary,
    activeEntities,
  }
}

export function rewriteFollowUpQuestion(question: string, memory: AgentMemory): string {
  const [primary, secondary] = memory.activeEntities
  if (!primary) return question

  let rewritten = question
  if (secondary) {
    rewritten = rewritten.replace(/刚才两个矿床/g, `${primary.name}与${secondary.name}`)
  }
  return rewritten.replace(/它/g, primary.name)
}
