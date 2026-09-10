import assert from 'node:assert/strict'
import { createModelStub, listenModelStub } from './model-stub.js'

const handle = await listenModelStub(createModelStub({ firstTokenMs: 1, tokenIntervalMs: 1 }), 0)
try {
  const jsonResponse = await fetch(`${handle.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'stub', messages: [{ role: 'user', content: 'hello' }] }),
  })
  assert.equal(jsonResponse.status, 200)
  const json = await jsonResponse.json() as { choices: Array<{ message: { content: string } }>; usage: { total_tokens: number } }
  assert.match(json.choices[0]!.message.content, /Synthetic geology/)
  assert.equal(json.usage.total_tokens, 30)

  const streamResponse = await fetch(`${handle.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'stub', stream: true, messages: [{ role: 'user', content: 'hello' }] }),
  })
  const streamText = await streamResponse.text()
  assert.equal(streamResponse.status, 200)
  assert.match(streamText, /data: \[DONE\]/)

  const rateLimited = await fetch(`${handle.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Stub-Scenario': 'rate_limit' },
    body: '{}',
  })
  assert.equal(rateLimited.status, 429)
  assert.equal(rateLimited.headers.get('retry-after'), '1')

  const toolResponse = await fetch(`${handle.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'stub',
      messages: [{ role: 'user', content: 'search' }],
      tools: [{ type: 'function', function: { name: 'search_documents' } }],
    }),
  })
  const toolJson = await toolResponse.json() as { choices: Array<{ message: { tool_calls: Array<{ function: { name: string } }> } }> }
  assert.equal(toolJson.choices[0]!.message.tool_calls[0]!.function.name, 'search_documents')
} finally {
  await handle.close()
}

console.log('[PASS] deterministic OpenAI-compatible model stub')
