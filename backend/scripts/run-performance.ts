import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { aggregateRun } from '../src/services/performance/aggregate.js'
import { parsePerformanceArgs, PERFORMANCE_HELP } from '../src/services/performance/cli.js'
import { askJson, askSse, login } from '../src/services/performance/http-client.js'
import { runLoadScenario, type ScenarioId } from '../src/services/performance/load-runner.js'
import { createModelStub, listenModelStub, type ModelStubHandle } from '../src/services/performance/model-stub.js'
import { sanitizePublicSummary, findSensitiveCanaries } from '../src/services/performance/privacy.js'
import { createWindowsProcessSampler, type ProcessResourceSample } from '../src/services/performance/process-sampler.js'
import { renderPrivateReport, renderPublicReport } from '../src/services/performance/report.js'
import type { BenchmarkCase, PerformanceRunManifest, PerformanceSummary, RequestObservation } from '../src/services/performance/types.js'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(backendRoot, '..')
const performanceRoot = path.join(backendRoot, 'evaluation', 'performance')
const outputRoot = path.join(performanceRoot, 'output')

function safeLabel(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/gu, '-')
  if (!normalized || normalized === '.' || normalized === '..') throw new Error('Invalid run label')
  return normalized
}

function containedOutputPath(value: string): string {
  const candidates = path.isAbsolute(value)
    ? [path.resolve(value)]
    : [path.resolve(value), path.resolve(repositoryRoot, value)]
  for (const resolved of candidates) {
    const relative = path.relative(outputRoot, resolved)
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) return resolved
  }
  throw new Error('Run path must stay inside the performance output directory')
}

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to allocate a test port')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

async function waitForHealth(baseURL: string, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return
    } catch { /* service is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`Backend did not become healthy at ${baseURL}`)
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function startBackend(input: {
  port: number
  outputDir: string
  synthetic: boolean
  stub?: ModelStubHandle
}): Promise<ChildProcess> {
  const stdout = createWriteStream(path.join(input.outputDir, 'backend.stdout.log'))
  const stderr = createWriteStream(path.join(input.outputDir, 'backend.stderr.log'))
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: backendRoot,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(input.port),
      PERF_TEST_MODE: 'true',
      SYNTHETIC_DEMO: input.synthetic ? 'true' : 'false',
      APP_DB_PATH: path.join(input.outputDir, 'runtime', 'app.db'),
      APP_DATA_DB_PATH: path.join(input.outputDir, 'runtime', 'qa.db'),
      ...(input.stub ? {
        DEEPSEEK_API_KEY: 'performance-stub-key',
        DEEPSEEK_BASE_URL: input.stub.baseURL,
        DEEPSEEK_MODEL: 'deepseek-chat',
        TONGYI_API_KEY: '',
      } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.pipe(stdout)
  child.stderr?.pipe(stderr)
  child.once('exit', () => { stdout.end(); stderr.end() })
  return child
}

async function loadQuestions(file: string): Promise<Array<{ id: string; question: string }>> {
  const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
  const values = Array.isArray(parsed) ? parsed : (parsed as { cases?: unknown[] }).cases
  if (!Array.isArray(values)) throw new Error('Question suite must be an array or contain a cases array')
  const questions = values.flatMap((item) => {
    const record = item as { id?: unknown; question?: unknown }
    return typeof record.id === 'string' && typeof record.question === 'string'
      ? [{ id: record.id, question: record.question }]
      : []
  })
  if (questions.length === 0) throw new Error('Question suite contains no valid cases')
  return questions
}

function profile(name: 'smoke' | 'quick' | 'formal'): {
  concurrency: number[]; warmupMs: number; durationMs: number; repeats: number; scenarios: ScenarioId[]
} {
  if (name === 'formal') return {
    concurrency: [1, 5, 10, 20], warmupMs: 15_000, durationMs: 60_000, repeats: 3,
    scenarios: ['hybrid-json', 'agent-json', 'agent-sse', 'agent-multiturn'],
  }
  if (name === 'quick') return {
    concurrency: [1, 5], warmupMs: 500, durationMs: 3_000, repeats: 1,
    scenarios: ['hybrid-json', 'agent-json', 'agent-sse', 'agent-multiturn'],
  }
  return {
    concurrency: [1, 2], warmupMs: 0, durationMs: 400, repeats: 1,
    scenarios: ['hybrid-json', 'agent-sse'],
  }
}

async function writeReports(
  outputDir: string,
  summary: PerformanceSummary,
  observations: RequestObservation[],
  resourceSamples: ProcessResourceSample[],
  canaries: string[],
): Promise<void> {
  const publicSummary = sanitizePublicSummary(summary)
  const publicSerialized = JSON.stringify(publicSummary, null, 2)
  const leaked = findSensitiveCanaries(publicSerialized, canaries)
  if (leaked.length > 0) throw new Error(`Public report contains private canaries: ${leaked.length}`)
  await Promise.all([
    writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(summary.manifest, null, 2)}\n`, 'utf8'),
    writeFile(path.join(outputDir, 'observations.private.jsonl'), `${observations.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8'),
    writeFile(path.join(outputDir, 'resources.private.json'), `${JSON.stringify(resourceSamples, null, 2)}\n`, 'utf8'),
    writeFile(path.join(outputDir, 'summary.private.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8'),
    writeFile(path.join(outputDir, 'report.private.md'), renderPrivateReport(summary), 'utf8'),
    writeFile(path.join(outputDir, 'summary.public.json'), `${publicSerialized}\n`, 'utf8'),
    writeFile(path.join(outputDir, 'report.public.md'), renderPublicReport(publicSummary), 'utf8'),
  ])
}

async function regenerateReport(runPath: string): Promise<void> {
  const outputDir = containedOutputPath(runPath)
  const summary = JSON.parse(await readFile(path.join(outputDir, 'summary.private.json'), 'utf8')) as PerformanceSummary
  const publicSummary = sanitizePublicSummary(summary)
  await Promise.all([
    writeFile(path.join(outputDir, 'summary.public.json'), `${JSON.stringify(publicSummary, null, 2)}\n`, 'utf8'),
    writeFile(path.join(outputDir, 'report.public.md'), renderPublicReport(publicSummary), 'utf8'),
  ])
  console.log(`Reports regenerated in ${outputDir}`)
}

async function runEndpointBenchmark(options: ReturnType<typeof parsePerformanceArgs>): Promise<void> {
  const isReal = options.command === 'real'
  const synthetic = options.command === 'smoke'
  const label = safeLabel(options.label)
  const timestamp = new Date().toISOString().replace(/[:.]/gu, '-')
  const runId = `${label}-${timestamp}`
  const outputDir = path.join(outputRoot, runId)
  await mkdir(path.join(outputDir, 'runtime'), { recursive: true })

  const questionPath = isReal
    ? path.resolve(options.suite!)
    : path.join(performanceRoot, 'load-questions.json')
  const questions = await loadQuestions(questionPath)
  const activeProfile = isReal
    ? { concurrency: [1, 2, 5], warmupMs: 0, durationMs: 1, repeats: 3, scenarios: ['hybrid-json', 'agent-json'] as ScenarioId[] }
    : profile(options.profile)
  if (isReal) {
    const estimated = questions.length * activeProfile.concurrency.length * activeProfile.repeats * activeProfile.scenarios.length
    console.log(`Real API run confirmed. Estimated endpoint requests: ${estimated}; Agent requests may invoke the model twice.`)
  }

  let stub: ModelStubHandle | undefined
  let backend: ChildProcess | undefined
  const observations: RequestObservation[] = []
  const resourceSamples: ProcessResourceSample[] = []
  let samplingTimer: ReturnType<typeof setInterval> | undefined
  try {
    if (!isReal) stub = await listenModelStub(createModelStub({ firstTokenMs: 40, tokenIntervalMs: 5 }), 0)
    const port = await freePort()
    backend = await startBackend({ port, outputDir, synthetic, stub })
    const baseURL = `http://127.0.0.1:${port}`
    await waitForHealth(baseURL)
    if (!synthetic) {
      const detail = await fetch(`${baseURL}/api/health/detailed`).then((response) => response.json()) as { flask?: { ok?: boolean }; neo4j?: { ok?: boolean } }
      if (!detail.flask?.ok || !detail.neo4j?.ok) throw new Error('Private local benchmark requires healthy Flask and Neo4j services')
    }
    const auth = await login(baseURL, { username: 'user', password: 'user123' })
    const targets = [
      { name: 'backend', pid: backend.pid! },
      { name: 'runner', pid: process.pid },
      ...(process.env.PERF_FLASK_PID ? [{ name: 'flask', pid: Number(process.env.PERF_FLASK_PID) }] : []),
      ...(process.env.PERF_NEO4J_PID ? [{ name: 'neo4j', pid: Number(process.env.PERF_NEO4J_PID) }] : []),
    ]
    const sampler = createWindowsProcessSampler(targets)
    const sample = async () => { resourceSamples.push(...await sampler.sample()) }
    await sample()
    samplingTimer = setInterval(() => { void sample() }, 1_000)

    let totalMeasuredDurationMs = 0
    for (const scenario of activeProfile.scenarios) {
      for (const concurrency of activeProfile.concurrency) {
        for (let repeat = 0; repeat < activeProfile.repeats; repeat += 1) {
          console.log(`[performance] ${scenario} concurrency=${concurrency} repeat=${repeat + 1}/${activeProfile.repeats}`)
          const result = await runLoadScenario({
            runId: `${runId}-c${concurrency}-r${repeat}`,
            scenario,
            concurrency,
            questions,
            warmupMs: activeProfile.warmupMs,
            durationMs: isReal ? Math.max(1, questions.length * 20) : activeProfile.durationMs,
          }, () => ({
            execute: async (request) => {
              const turnQuestion = request.turnIndex === 1
                ? '它受什么构造控制？'
                : request.turnIndex === 2 ? '比较它与花岗岩的地质关系。' : request.question
              const clientInput = {
                baseURL,
                token: auth.token,
                runId,
                requestId: request.requestId,
                caseId: request.caseId,
                question: turnQuestion,
                mode: scenario === 'hybrid-json' ? 'hybrid' as const : 'agent' as const,
                retrievalMode: 'hybrid' as const,
                conversationId: request.conversationId,
                timeoutMs: 90_000,
              }
              return scenario === 'agent-sse' ? askSse(clientInput) : askJson(clientInput)
            },
          }))
          observations.push(...result.observations.map((item) => ({ ...item, runId })))
          totalMeasuredDurationMs += result.durationMs
        }
      }
    }
    if (samplingTimer) clearInterval(samplingTimer)
    await sample()

    const manifest: PerformanceRunManifest = {
      runId,
      label,
      createdAt: new Date().toISOString(),
      gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(),
      nodeVersion: process.versions.node,
      model: isReal ? (process.env.DEEPSEEK_MODEL || 'deepseek-chat') : 'performance-stub',
      synthetic,
    }
    const benchmarkCases: BenchmarkCase[] = questions.map((item) => ({ ...item, kind: 'supported' }))
    const summary = aggregateRun({
      manifest,
      observations,
      cases: benchmarkCases,
      durationMs: totalMeasuredDurationMs,
      resourceSamples,
      limitations: [
        ...(synthetic ? ['Synthetic harness validation only.'] : []),
        ...(isReal ? ['Remote model latency is environment-dependent.'] : ['LLM timing uses a deterministic local stub.']),
        ...(!process.env.PERF_FLASK_PID || !process.env.PERF_NEO4J_PID
          ? ['Flask/Neo4j process resource sampling requires PERF_FLASK_PID and PERF_NEO4J_PID.'] : []),
      ],
    })
    await writeReports(outputDir, summary, observations, resourceSamples, questions.map((item) => item.question))
    console.log(`Performance run complete: ${outputDir}`)
    console.log(`Public report: ${path.join(outputDir, 'report.public.md')}`)
  } finally {
    if (samplingTimer) clearInterval(samplingTimer)
    await stopChild(backend)
    if (stub) await stub.close()
  }
}

const options = parsePerformanceArgs(process.argv.slice(2))
if (options.command === 'help') console.log(PERFORMANCE_HELP)
else if (options.command === 'report') await regenerateReport(options.run!)
else await runEndpointBenchmark(options)
