import { createModelStub, listenModelStub } from '../src/services/performance/model-stub.js'

const args = new Map(process.argv.slice(2).flatMap((value, index, values) => {
  if (!value.startsWith('--')) return []
  return [[value.slice(2), values[index + 1] ?? 'true']]
}))
const handle = await listenModelStub(createModelStub({
  firstTokenMs: Number(args.get('first-token-ms') ?? 300),
  tokenIntervalMs: Number(args.get('token-interval-ms') ?? 20),
  scenario: (args.get('scenario') ?? 'success') as Parameters<typeof createModelStub>[0]['scenario'],
}), Number(args.get('port') ?? 4010))

console.log(JSON.stringify({ baseURL: handle.baseURL, pid: process.pid }))
process.on('SIGINT', () => { void handle.close().finally(() => process.exit(0)) })
process.on('SIGTERM', () => { void handle.close().finally(() => process.exit(0)) })
