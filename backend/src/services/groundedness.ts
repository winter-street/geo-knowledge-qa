export type ExpectedAnswerMode = 'answer' | 'refuse'
export type BenchmarkMethod = 'system' | 'direct'
export type ClaimVerdict = 'supported' | 'unsupported' | 'non_factual'

export interface EvidenceReference {
  docId: number
  page: number
  note: string
}

export interface GroundednessCase {
  id: string
  category: '矿床特征' | '构造控制' | '赋存岩石' | '成矿年代' | '区域比较' | '无证据拒答'
  question: string
  expectedMode: ExpectedAnswerMode
  evidence: EvidenceReference[]
}

export interface ClaimJudgement {
  text: string
  verdict: ClaimVerdict
  evidenceRefs: string[]
}

export interface AnswerJudgement {
  isRefusal: boolean
  claims: ClaimJudgement[]
}

export interface BenchmarkAnswerRecord {
  caseId: string
  expectedMode: ExpectedAnswerMode
  method: BenchmarkMethod
  answer: string
  judgement?: AnswerJudgement
  status: 'judged' | 'unjudged'
  error?: string
}

export interface MetricSummary {
  totalAnswers: number
  judgedAnswers: number
  unjudgedAnswers: number
  factualClaims: number
  supportedClaims: number
  unsupportedClaims: number
  unsupportedClaimRate: number | null
  answerHallucinationRate: number | null
  unanswerableFalseAnswerRate: number | null
  supportedCaseRefusalRate: number | null
}

export interface ConfidenceInterval {
  low: number | null
  high: number | null
}

export function validateGroundednessCases(cases: GroundednessCase[]): string[] {
  const errors: string[] = []
  if (cases.length !== 30) errors.push(`评测集应包含 30 题，当前为 ${cases.length} 题`)
  const ids = new Set<string>()
  for (const item of cases) {
    if (!item.id.trim()) errors.push('存在空白题目 id')
    if (ids.has(item.id)) errors.push(`题目 id 重复：${item.id}`)
    ids.add(item.id)
    if (!item.question.trim()) errors.push(`题目 ${item.id} 缺少问题文本`)
    if (item.expectedMode === 'answer' && item.evidence.length === 0) {
      errors.push(`有依据题 ${item.id} 缺少冻结文献证据`)
    }
    if (item.expectedMode === 'refuse' && item.evidence.length !== 0) {
      errors.push(`拒答题 ${item.id} 不应绑定文献证据`)
    }
  }
  const supported = cases.filter((item) => item.expectedMode === 'answer').length
  const refusal = cases.filter((item) => item.expectedMode === 'refuse').length
  if (supported !== 25 || refusal !== 5) errors.push(`题目构成应为 25 道有依据题和 5 道拒答题，当前为 ${supported}/${refusal}`)
  return errors
}

function normalizeVerdict(value: unknown): ClaimVerdict | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (['supported', '支持', '有证据支持'].includes(normalized)) return 'supported'
  if (['unsupported', '无证据支持', '不支持'].includes(normalized)) return 'unsupported'
  if (['non_factual', 'non-factual', '非事实', '非事实性'].includes(normalized)) return 'non_factual'
  return null
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (fenced?.[1] || raw).trim()
}

export function parseJudgeResponse(raw: string): AnswerJudgement {
  const parsed = JSON.parse(extractJson(raw)) as Record<string, unknown>
  if (typeof parsed.isRefusal !== 'boolean' || !Array.isArray(parsed.claims)) {
    throw new Error('裁判输出缺少 isRefusal 或 claims')
  }
  const claims: ClaimJudgement[] = parsed.claims.map((claim, index) => {
    if (!claim || typeof claim !== 'object') throw new Error(`第 ${index + 1} 条断言格式错误`)
    const item = claim as Record<string, unknown>
    const verdict = normalizeVerdict(item.verdict)
    if (!verdict || typeof item.text !== 'string') throw new Error(`第 ${index + 1} 条断言缺少 text 或 verdict`)
    return {
      text: item.text.trim(),
      verdict,
      evidenceRefs: Array.isArray(item.evidenceRefs)
        ? item.evidenceRefs.map((ref) => String(ref)).filter(Boolean)
        : [],
    }
  })
  return { isRefusal: parsed.isRefusal, claims }
}

export function shuffleMethods(
  random: () => number = Math.random,
): BenchmarkMethod[] {
  return random() < 0.5 ? ['system', 'direct'] : ['direct', 'system']
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

export function calculateMetrics(records: BenchmarkAnswerRecord[]): MetricSummary {
  const judged = records.filter((record) => record.status === 'judged' && record.judgement)
  const factualClaims = judged.flatMap((record) => record.judgement!.claims)
    .filter((claim) => claim.verdict !== 'non_factual')
  const unsupportedClaims = factualClaims.filter((claim) => claim.verdict === 'unsupported')
  const answersWithUnsupported = judged.filter((record) =>
    record.judgement!.claims.some((claim) => claim.verdict === 'unsupported'),
  )
  const refusalCases = judged.filter((record) => record.expectedMode === 'refuse')
  const falseAnswers = refusalCases.filter((record) =>
    record.judgement!.claims.some((claim) => claim.verdict !== 'non_factual'),
  )
  const supportedCases = judged.filter((record) => record.expectedMode === 'answer')
  const unnecessaryRefusals = supportedCases.filter((record) => record.judgement!.isRefusal)

  return {
    totalAnswers: records.length,
    judgedAnswers: judged.length,
    unjudgedAnswers: records.length - judged.length,
    factualClaims: factualClaims.length,
    supportedClaims: factualClaims.filter((claim) => claim.verdict === 'supported').length,
    unsupportedClaims: unsupportedClaims.length,
    unsupportedClaimRate: ratio(unsupportedClaims.length, factualClaims.length),
    answerHallucinationRate: ratio(answersWithUnsupported.length, judged.length),
    unanswerableFalseAnswerRate: ratio(falseAnswers.length, refusalCases.length),
    supportedCaseRefusalRate: ratio(unnecessaryRefusals.length, supportedCases.length),
  }
}

export function createSeededRandom(seed = 20260714): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function bootstrapUnsupportedClaimInterval(
  records: BenchmarkAnswerRecord[],
  iterations = 2000,
  random = createSeededRandom(),
): ConfidenceInterval {
  const judged = records.filter((record) => record.status === 'judged' && record.judgement)
  if (!judged.length) return { low: null, high: null }
  const samples: number[] = []
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sampled = Array.from({ length: judged.length }, () => judged[Math.floor(random() * judged.length)]!)
    const metric = calculateMetrics(sampled).unsupportedClaimRate
    if (metric !== null) samples.push(metric)
  }
  if (!samples.length) return { low: null, high: null }
  samples.sort((left, right) => left - right)
  return {
    low: samples[Math.floor((samples.length - 1) * 0.025)]!,
    high: samples[Math.floor((samples.length - 1) * 0.975)]!,
  }
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

export function renderComparisonSvg(
  system: MetricSummary,
  direct: MetricSummary,
  systemInterval: ConfidenceInterval,
  directInterval: ConfidenceInterval,
): string {
  const width = 920
  const height = 420
  const chartTop = 84
  const chartHeight = 220
  const y = (value: number) => chartTop + chartHeight - value * chartHeight
  const barWidth = 128
  const bars = [
    { label: '本系统', x: 250, metric: system.unsupportedClaimRate, interval: systemInterval, color: '#2E7D5B' },
    { label: 'DeepSeek 直答', x: 540, metric: direct.unsupportedClaimRate, interval: directInterval, color: '#B83A1F' },
  ]
  const grid = [0, 0.25, 0.5, 0.75, 1].map((value) =>
    `<line x1="110" y1="${y(value)}" x2="820" y2="${y(value)}" stroke="#E2DFD6"/><text x="96" y="${y(value) + 4}" text-anchor="end" fill="#6B6B78" font-size="12">${Math.round(value * 100)}%</text>`,
  ).join('')
  const barSvg = bars.map((bar) => {
    const metric = bar.metric ?? 0
    const low = bar.interval.low ?? metric
    const high = bar.interval.high ?? metric
    const center = bar.x + barWidth / 2
    return `<rect x="${bar.x}" y="${y(metric)}" width="${barWidth}" height="${metric * chartHeight}" fill="${bar.color}"/>
      <line x1="${center}" y1="${y(high)}" x2="${center}" y2="${y(low)}" stroke="#1A1A2E" stroke-width="2"/>
      <line x1="${center - 7}" y1="${y(high)}" x2="${center + 7}" y2="${y(high)}" stroke="#1A1A2E" stroke-width="2"/>
      <line x1="${center - 7}" y1="${y(low)}" x2="${center + 7}" y2="${y(low)}" stroke="#1A1A2E" stroke-width="2"/>
      <text x="${center}" y="${y(metric) - 10}" text-anchor="middle" fill="#1A1A2E" font-size="20" font-family="Georgia, serif">${formatPercent(bar.metric)}</text>
      <text x="${center}" y="${chartTop + chartHeight + 32}" text-anchor="middle" fill="#2D2D3A" font-size="14">${bar.label}</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#FEFDF9"/>
    <text x="56" y="42" fill="#1A1A2E" font-size="25" font-family="Georgia, serif">文献证据不支持率（操作化幻觉率）</text>
    <text x="56" y="64" fill="#6B6B78" font-size="12">误差线为按题目 bootstrap 的 95% 区间；数值越低越好</text>
    ${grid}${barSvg}
    <text x="56" y="370" fill="#6B6B78" font-size="11">口径：无证据支持的事实断言 / 全部事实断言。仅评价本地地质文献与 factual KG 覆盖范围。</text>
  </svg>`
}
