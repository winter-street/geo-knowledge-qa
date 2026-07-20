import assert from 'node:assert/strict'
import { analyzeKgQuestion } from './kg-query-analysis.js'

const result = analyzeKgQuestion('攀西钒钛磁铁矿受什么构造控制？', [
  '攀西',
  '钒钛磁铁矿',
  '受',
  '什么',
  '构造',
  '控制',
])

assert.deepEqual(result.regionTerms, ['攀西'])
assert.deepEqual(result.entityTerms, ['钒钛磁铁矿'])
assert.deepEqual(result.relationIntents, ['CONTROLLED_BY'])
assert.equal(result.keywords.includes('什么'), false)

const longest = analyzeKgQuestion('钒钛磁铁矿和钒钛', [
  '钒钛磁铁矿',
  '和',
  '钒钛',
])
assert.deepEqual(longest.keywords, ['钒钛磁铁矿'])

const hostRock = analyzeKgQuestion('攀枝花矿床赋存在哪类岩石中', [
  '攀枝花矿床',
  '赋存',
  '哪些',
  '岩石',
])
assert.deepEqual(hostRock.relationIntents, ['HOSTED_IN'])
assert.deepEqual(hostRock.owlRules, ['RockHostedMineral'])

console.log('[PASS] KG query analysis')
