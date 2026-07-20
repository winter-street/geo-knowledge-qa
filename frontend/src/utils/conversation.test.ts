import assert from 'node:assert/strict'
import { createConversationTitle, DEFAULT_CONVERSATION_TITLE } from './conversation'

assert.equal(
  createConversationTitle('请问尾亚断裂带对矿产分布有什么控制作用？'),
  '尾亚断裂带对矿产分布有什么控制作用',
)
assert.equal(
  createConversationTitle('帮我分析一下钒钛磁铁矿的成因类型有哪些？'),
  '钒钛磁铁矿的成因类型',
)
assert.equal(createConversationTitle('   '), DEFAULT_CONVERSATION_TITLE)
assert.equal(
  createConversationTitle('请介绍这是一个超过二十个字的地质找矿问题标题用于测试'),
  '这是一个超过二十个字的地质找矿问题标题用…',
)

console.log('conversation title assertions passed')
