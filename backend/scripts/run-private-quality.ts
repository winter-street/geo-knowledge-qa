import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { generateAnswer } from '../src/services/llm.js'
import {
  estimatePrivateApiCalls,
  hashPrivateSuite,
  privateEvaluationSuiteSchema,
  projectPrivateRunPublicly,
  type PrivateQualityMode,
  type PrivateQualityObservation,
  type PrivateQualityRun,
} from '../src/services/evaluation/private-quality.js'
import {
  privateObservationKey,
  runPrivateQualityEvaluation,
  type PrivateAdapterObservation,
  type PrivateQualityAdapter,
} from '../src/services/evaluation/private-quality-runner.js'
import { fingerprintDocumentId } from '../src/services/evaluation/document-fingerprint.js'
import { renderBlindReviewCsv } from '../src/services/evaluation/private-blind-review.js'
import type { AgentIntent, AgentToolName } from '../src/types/index.js'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function requiredArg(name: string, fallback?: string): string {
  const value = arg(name) ?? fallback
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function isRefusalAnswer(answer: string): boolean {
  return /(证据不足|无法确认|无法判断|暂未收录|没有相关证据|cannot confirm|insufficient evidence)/i.test(answer)
}

function parseCitationIds(answer: string, raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const ids = raw.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const id = (item as { id?: unknown }).id
      return typeof id === 'string' ? [id] : []
    })
    if (ids.length > 0) return ids
  }
  return [...new Set(answer.match(/\[(?:D\d+-P\d+|KG\d+)\]/g) ?? [])]
    .map((value) => value.slice(1, -1))
}

class PrivateHttpAdapter implements PrivateQualityAdapter {
  private token = ''
  private fingerprints = new Map<number, string | undefined>()

  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly password: string,
  ) {}

  async login(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.username, password: this.password }),
    })
    if (!response.ok) throw new Error(`Login failed: HTTP ${response.status}`)
    const body = await response.json() as { token?: string }
    if (!body.token) throw new Error('Login response did not include a token')
    this.token = body.token
  }

  async executeDirect(input: { testCase: any }): Promise<PrivateAdapterObservation> {
    const started = performance.now()
    const generated = await generateAnswer(input.testCase.question, [], [], 'hybrid')
    return {
      answer: generated.answer,
      retrievedDocumentFingerprints: [],
      citationIds: parseCitationIds(generated.answer, generated.sources),
      selectedTools: [],
      linkedEntityIds: [],
      ...(isRefusalAnswer(generated.answer) ? { agentOutcome: 'refused' as const } : {}),
      replanCount: 0,
      latencyMs: Math.round(performance.now() - started),
    }
  }

  async executeQa(input: {
    mode: Exclude<PrivateQualityMode, 'direct'>
    testCase: any
    conversationId?: string
  }): Promise<PrivateAdapterObservation> {
    const started = performance.now()
    const agentMode = input.mode === 'agent' ? 'agent' : 'direct'
    const retrievalMode = input.mode === 'agent' ? 'hybrid' : input.mode
    const response = await fetch(`${this.baseUrl}/api/qa/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        question: input.testCase.question,
        retrievalMode,
        agentMode,
        conversationId: input.conversationId,
      }),
    })
    if (!response.ok) throw new Error(`QA request failed: HTTP ${response.status}`)
    const body = await response.json() as Record<string, unknown>
    const sources = Array.isArray(body.sources) ? body.sources : []
    const retrievedDocumentFingerprints: string[] = []
    for (const source of sources) {
      if (!source || typeof source !== 'object') continue
      const docId = Number((source as { docId?: unknown }).docId)
      if (!Number.isInteger(docId)) continue
      if (!this.fingerprints.has(docId)) this.fingerprints.set(docId, fingerprintDocumentId(docId))
      const fingerprint = this.fingerprints.get(docId)
      if (fingerprint) retrievedDocumentFingerprints.push(fingerprint)
    }
    const toolTrace = Array.isArray(body.toolTrace) ? body.toolTrace : []
    const selectedTools = toolTrace.flatMap((trace) => {
      if (!trace || typeof trace !== 'object') return []
      const toolName = (trace as { toolName?: unknown }).toolName
      return typeof toolName === 'string' ? [toolName as AgentToolName] : []
    })
    const linkedEntityIds = Array.isArray(body.linkedEntities)
      ? body.linkedEntities.flatMap((entity) => {
        if (!entity || typeof entity !== 'object') return []
        const id = (entity as { id?: unknown }).id
        return typeof id === 'string' ? [id] : []
      })
      : []
    const answer = typeof body.answer === 'string' ? body.answer : ''
    const agentOutcome = typeof body.agentOutcome === 'string'
      ? body.agentOutcome as 'answered' | 'clarification_required' | 'refused'
      : isRefusalAnswer(answer) ? 'refused' as const : undefined
    return {
      answer,
      retrievedDocumentFingerprints: [...new Set(retrievedDocumentFingerprints)],
      citationIds: parseCitationIds(answer, body.citations),
      ...(typeof body.intent === 'string' ? { predictedIntent: body.intent as AgentIntent } : {}),
      selectedTools: [...new Set(selectedTools)],
      linkedEntityIds,
      ...(agentOutcome ? { agentOutcome } : {}),
      replanCount: typeof body.replanCount === 'number' ? body.replanCount : 0,
      latencyMs: Math.round(performance.now() - started),
      ...(typeof body.conversationId === 'string' ? { conversationId: body.conversationId } : {}),
    }
  }
}

function parseJsonLines(content: string): PrivateQualityObservation[] {
  return content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as PrivateQualityObservation] } catch { return [] }
  })
}

function renderPublicMarkdown(report: ReturnType<typeof projectPrivateRunPublicly>): string {
  const rows = Object.entries(report.modes as Record<string, any>).map(([mode, metrics]) =>
    `| ${mode} | ${metrics.observationCount} | ${metrics.recallAt5.toFixed(3)} | ${metrics.mrrAt10.toFixed(3)} | ${metrics.latencyMs.p95} | ${metrics.replanTriggerRate.toFixed(3)} |`,
  )
  return `# Private domain evaluation summary\n\n`
    + `This file is an anonymous projection of a private run. Questions, answers, document titles, evidence and entity IDs are intentionally excluded.\n\n`
    + `Human semantic review: **${report.humanReviewStatus}**\n\n`
    + `| Mode | Observations | Recall@5 | MRR@10 | P95 latency (ms) | Replan rate |\n|---|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n`
}

async function main(): Promise<void> {
  if (!process.argv.includes('--confirm-real-api')) {
    throw new Error('Private evaluation requires --confirm-real-api. No model call was made.')
  }
  const variant = requiredArg('--variant', 'candidate') as 'baseline' | 'candidate'
  if (!['baseline', 'candidate'].includes(variant)) throw new Error('--variant must be baseline or candidate')
  const suitePath = path.resolve(requiredArg('--suite', path.join(backendRoot, 'evaluation/private/suite.json')))
  const suite = privateEvaluationSuiteSchema.parse(JSON.parse(await readFile(suitePath, 'utf8')))
  const label = requiredArg('--label', `${variant}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  const estimate = estimatePrivateApiCalls(suite, variant)
  const maxApiCalls = Number(arg('--max-api-calls') ?? estimate.limits.hard)
  if (estimate.estimated > maxApiCalls) throw new Error(`Estimated ${estimate.estimated} API calls exceed hard cap ${maxApiCalls}`)
  if (estimate.estimated >= estimate.limits.warning) {
    console.warn(`[private-evaluation] warning: estimated ${estimate.estimated} API calls (threshold ${estimate.limits.warning})`)
  }

  const outputDir = path.resolve(arg('--output', path.join(backendRoot, 'evaluation/output', label))!)
  await mkdir(outputDir, { recursive: true })
  const observationsPath = path.join(outputDir, 'observations.private.jsonl')
  let existing: PrivateQualityObservation[] = []
  try { existing = parseJsonLines(await readFile(observationsPath, 'utf8')) } catch { /* first run */ }
  const completedKeys = new Set(existing.map(privateObservationKey))
  const adapter = new PrivateHttpAdapter(
    requiredArg('--base-url', 'http://127.0.0.1:3000'),
    process.env.EVAL_USERNAME ?? 'user',
    process.env.EVAL_PASSWORD ?? 'user123',
  )
  await adapter.login()
  const startedAt = new Date().toISOString()
  const fresh = await runPrivateQualityEvaluation({
    suite,
    variant,
    adapter,
    completedKeys,
    onObservation: async (observation) => {
      await appendFile(observationsPath, `${JSON.stringify(observation)}\n`, 'utf8')
    },
  })
  const allByKey = new Map([...existing, ...fresh].map((item) => [privateObservationKey(item), item]))
  const run: PrivateQualityRun = {
    label,
    variant,
    suiteHash: hashPrivateSuite(suite),
    startedAt,
    completedAt: new Date().toISOString(),
    observations: [...allByKey.values()],
  }
  const publicReport = projectPrivateRunPublicly(run)
  await Promise.all([
    writeFile(path.join(outputDir, 'run.private.json'), `${JSON.stringify(run, null, 2)}\n`, 'utf8'),
    writeFile(path.join(outputDir, 'summary.public.json'), `${JSON.stringify(publicReport, null, 2)}\n`, 'utf8'),
    writeFile(path.join(outputDir, 'report.public.md'), renderPublicMarkdown(publicReport), 'utf8'),
  ])
  const baselinePath = arg('--baseline-run')
  if (baselinePath) {
    const baseline = JSON.parse(await readFile(path.resolve(baselinePath), 'utf8')) as PrivateQualityRun
    await writeFile(path.join(outputDir, 'blind-review.private.csv'), renderBlindReviewCsv(baseline, run), 'utf8')
  }
  console.log(`Private evaluation complete: ${outputDir}`)
}

main().catch((error) => {
  console.error(`[private-evaluation] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
