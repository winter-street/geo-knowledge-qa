/**
 * 会话搜索过滤——纯函数，按标题模糊匹配。
 * QaView 侧边栏搜索框使用。
 */
export function filterConversations<T extends { title: string }>(
  conversations: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return conversations
  return conversations.filter(c => c.title.toLowerCase().includes(q))
}
