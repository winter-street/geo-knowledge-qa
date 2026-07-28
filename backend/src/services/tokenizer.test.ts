import assert from 'node:assert/strict'
import { tokenize, tokenizeBatch } from './tokenizer.js'

assert.deepEqual(
  tokenize('花岗岩与斑岩铜矿有什么关系？'),
  ['花岗岩', '斑岩铜矿', '什么', '关系'],
)
assert.deepEqual(tokenize('Neo4j RAG hybrid'), ['Neo4j', 'RAG', 'hybrid'])
assert.deepEqual(tokenizeBatch(['断裂带控制矿床', '燕山期花岗岩']), [
  ['断裂带', '控制', '矿床'],
  ['燕山期', '花岗岩'],
])

console.log('[PASS] deterministic Node 22 tokenizer preserves domain terms')
