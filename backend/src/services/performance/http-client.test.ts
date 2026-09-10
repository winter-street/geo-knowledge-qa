import assert from 'node:assert/strict'
import { createModelStub, listenModelStub } from './model-stub.js'
import { askJson, askSse } from './http-client.js'

const app = await listenModelStub(createModelStub({ firstTokenMs: 1 }), 0)
const fakeServer = await (async () => {
  const { createServer } = await import('node:http')
  const server = createServer((request, response) => {
    if (request.url === '/api/qa/ask') {
      if (request.headers.accept === 'text/event-stream') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.write('data: {"type":"meta"}\n\n')
        response.write('data: {"type":"chunk","content":"ok"}\n\n')
        response.write('data: {"type":"performance","performance":{"stages":{"total":3},"counters":{}}}\n\n')
        response.end('data: {"type":"done","citations":[{"id":"D1-P1"}],"sources":[{"docId":1}],"toolTrace":[]}\n\n')
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ citations: [{ id: 'D1-P1' }], sources: [{ docId: 1 }], toolTrace: [], performance: { stages: { total: 2 }, counters: {} } }))
      }
      return
    }
    response.writeHead(404).end()
  }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const address = server.address()
  return { server, baseURL: `http://127.0.0.1:${(address as { port: number }).port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
})()

try {
  const json = await askJson({ baseURL: fakeServer.baseURL, token: 'token', runId: 'run', requestId: 'request', caseId: 'case', question: 'q', mode: 'hybrid' })
  assert.equal(json.status, 'success')
  assert.deepEqual(json.citationIds, ['D1-P1'])
  assert.deepEqual(json.retrievedDocumentIds, ['1'])

  const sse = await askSse({ baseURL: fakeServer.baseURL, token: 'token', runId: 'run', requestId: 'request-2', caseId: 'case', question: 'q', mode: 'agent' })
  assert.equal(sse.status, 'success')
  assert.ok((sse.firstEventMs ?? 0) >= 0)
  assert.ok((sse.firstContentMs ?? 0) >= 0)
} finally {
  await app.close()
  await fakeServer.close()
}

console.log('[PASS] JWT-aware JSON/SSE performance client')
