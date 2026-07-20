export const DEFAULT_CONVERSATION_TITLE = '新对话'

const MAX_TITLE_LENGTH = 20

/**
 * Derive a compact topic title from the first user question without an extra
 * LLM request. Courtesy phrases and trailing question particles add little
 * value in the conversation list, so they are removed before truncation.
 */
export function createConversationTitle(content: string): string {
  let title = content
    .replace(/\s+/g, ' ')
    .replace(/^[#>*\-\s]+/, '')
    .trim()

  title = title
    .replace(
      /^(?:请问|请帮我|帮我|麻烦(?:你)?|我想(?:了解|知道|咨询)|能否|可否|可以(?:帮我)?|请)\s*/,
      '',
    )
    .replace(/^(?:分析|介绍|说明|解释|查询|查找|总结|概括|看看)(?:一下)?[\s,:：，]*/, '')
    .replace(/[\s。，,？?!！；;:：]+$/g, '')
    .replace(/(?:是什么|有哪些|是怎样的|怎么样|吗|呢)$/g, '')
    .trim()

  if (!title) return DEFAULT_CONVERSATION_TITLE
  return title.length > MAX_TITLE_LENGTH
    ? `${title.slice(0, MAX_TITLE_LENGTH)}…`
    : title
}
