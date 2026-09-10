import http, { type IncomingMessage, type ServerResponse } from 'node:http'

export type ModelStubScenario =
  | 'success'
  | 'unauthorized'
  | 'rate_limit'
  | 'server_error'
  | 'disconnect'
  | 'timeout'

export interface ModelStubOptions {
  scenario?: ModelStubScenario
  firstTokenMs?: number
  tokenIntervalMs?: number
  responseText?: string
  timeoutMs?: number
}

export interface ModelStubHandle {
  server: http.Server
  baseURL: string
  close(): Promise<void>
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(value && typeof value === 'object' ? value as Record<string, unknown> : {})
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

function toolArguments(name: string): Record<string, unknown> {
  if (name === 'search_documents') return { query: 'synthetic geology', topK: 20, retrievalMode: 'tfidf' }
  if (name === 'query_knowledge_graph') return { question: 'synthetic geology' }
  if (name === 'spatial_query') return { question: 'synthetic geology' }
  if (name === 'get_entity_detail') return { entityId: 'SYN-ENTITY-01' }
  return {}
}

function responseText(options: ModelStubOptions): string {
  return options.responseText ?? 'Synthetic geology answer [D1-P1].'
}

async function handleCompletion(
  request: IncomingMessage,
  response: ServerResponse,
  options: ModelStubOptions,
): Promise<void> {
  const scenario = (request.headers['x-stub-scenario'] as ModelStubScenario | undefined) ?? options.scenario ?? 'success'
  if (scenario === 'unauthorized') {
    sendJson(response, 401, { error: { message: 'synthetic unauthorized' } })
    return
  }
  if (scenario === 'rate_limit') {
    response.setHeader('Retry-After', '1')
    sendJson(response, 429, { error: { message: 'synthetic rate limit' } })
    return
  }
  if (scenario === 'server_error') {
    sendJson(response, 500, { error: { message: 'synthetic server error' } })
    return
  }

  const body: Record<string, unknown> = await readJson(request).catch(() => ({} as Record<string, unknown>))
  const stream = body.stream === true
  const tools = Array.isArray(body.tools) ? body.tools as Array<{ function?: { name?: string } }> : []
  const firstToolName = tools[0]?.function?.name
  const configuredFirstTokenMs = Math.max(0, options.firstTokenMs ?? 25)
  const intervalMs = Math.max(0, options.tokenIntervalMs ?? 5)
  const text = responseText(options)

  if (scenario === 'timeout') {
    await delay(options.timeoutMs ?? 2_000)
  } else {
    await delay(configuredFirstTokenMs)
  }

  if (scenario === 'disconnect') {
    response.destroy()
    return
  }

  const usage = { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
  if (!stream) {
    const message = firstToolName
      ? {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'stub-tool-call-1',
            type: 'function',
            function: { name: firstToolName, arguments: JSON.stringify(toolArguments(firstToolName)) },
          }],
        }
      : { role: 'assistant', content: text }
    sendJson(response, 200, {
      id: 'stub-completion',
      object: 'chat.completion',
      choices: [{ index: 0, message, finish_reason: firstToolName ? 'tool_calls' : 'stop' }],
      usage,
    })
    return
  }

  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const chunks = text.split(/(?<=\s)/u).filter(Boolean)
  for (let index = 0; index < chunks.length; index += 1) {
    const content = chunks[index]!
    response.write(`data: ${JSON.stringify({
      id: 'stub-stream',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    })}\n\n`)
    if (index < chunks.length - 1) await delay(intervalMs)
  }
  response.write('data: [DONE]\n\n')
  response.end()
}

export function createModelStub(options: ModelStubOptions = {}): http.Server {
  return http.createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      sendJson(response, 404, { error: { message: 'Not found' } })
      return
    }
    try {
      await handleCompletion(request, response, options)
    } catch (error) {
      if (!response.headersSent) sendJson(response, 400, { error: { message: String(error) } })
      else response.destroy(error instanceof Error ? error : undefined)
    }
  })
}

export async function listenModelStub(
  server: http.Server,
  port = 0,
  host = '127.0.0.1',
): Promise<ModelStubHandle> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Model stub did not expose a TCP port')
  return {
    server,
    baseURL: `http://${host}:${address.port}/v1`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}
