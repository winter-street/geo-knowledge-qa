import assert from 'node:assert/strict'
import { classifyAgentIntent } from './intent.js'

assert.equal(classifyAgentIntent('辉长岩与磁铁矿有什么关系？'), 'geology_qa')
assert.equal(classifyAgentIntent('介绍演示矿床 A 的实体详情'), 'entity_lookup')
assert.equal(classifyAgentIntent('演示矿床 A 附近 10 公里有哪些断裂？'), 'spatial_analysis')
assert.equal(classifyAgentIntent('比较东部演示区和西部演示区的矿产差异'), 'region_comparison')
assert.equal(classifyAgentIntent('你好，今天怎么样？'), 'chitchat')
assert.equal(classifyAgentIntent('它呢？', { hasActiveEntities: false }), 'clarification')
assert.equal(classifyAgentIntent('它赋存在哪里？', { hasActiveEntities: true }), 'geology_qa')

console.log('[PASS] agent intent classification')
