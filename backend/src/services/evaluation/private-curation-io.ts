import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import Database from 'better-sqlite3'
import path from 'node:path'
import type {
  CurationChunk,
  CurationDocument,
  PrivateDataSnapshot,
  PrivateEvidencePack,
  PrivateGraphSnapshot,
  PrivateCandidateRecord,
} from './private-curation.js'
import { buildEvidencePacks, createPrivateSnapshot, privateCandidateRecordSchema } from './private-curation.js'

export interface PrivateGraphEvidence {
  entities: PrivateEvidencePack['entities']
  kgPaths: PrivateEvidencePack['kgPaths']
  spatialEligible: boolean
}

export interface PrivateGraphExport {
  snapshot: PrivateGraphSnapshot
  evidenceByDocumentId: Map<number, PrivateGraphEvidence>
}

export interface PrivateCorpus {
  documents: CurationDocument[]
  chunks: CurationChunk[]
}

function requireTable(db: Database.Database, table: string): void {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
  if (!row) throw new Error(`Private corpus is missing required table: ${table}`)
}

export function loadPrivateCorpus(dbPath: string): PrivateCorpus {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    requireTable(db, 'documents')
    requireTable(db, 'chunks')
    const documents = db.prepare(`
      SELECT id, title, doc_type AS docType, total_pages AS totalPages
      FROM documents ORDER BY id
    `).all() as CurationDocument[]
    const chunks = db.prepare(`
      SELECT id, doc_id AS docId, page, chunk_index AS chunkIndex, text
      FROM chunks ORDER BY doc_id, page, chunk_index, id
    `).all() as CurationChunk[]
    return { documents, chunks }
  } finally {
    db.close()
  }
}

export async function sha256File(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

function jsonLines(values: unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join('\n') + (values.length > 0 ? '\n' : '')
}

export async function exportPrivateCurationAssets(input: {
  dbPath: string
  outputDirectory: string
  frozenAt?: string
  graphProvider?: () => Promise<PrivateGraphExport>
}): Promise<{ snapshot: PrivateDataSnapshot; evidencePacks: PrivateEvidencePack[] }> {
  const corpus = loadPrivateCorpus(input.dbPath)
  const graph = input.graphProvider
    ? await input.graphProvider()
    : {
      snapshot: { available: false, nodeCount: 0, relationshipCount: 0, entityIds: [] },
      evidenceByDocumentId: new Map<number, PrivateGraphEvidence>(),
    }
  const snapshot = createPrivateSnapshot({
    sqliteSha256: await sha256File(input.dbPath),
    documents: corpus.documents,
    chunks: corpus.chunks,
    graph: graph.snapshot,
    frozenAt: input.frozenAt ?? new Date().toISOString(),
  })
  const evidencePacks = buildEvidencePacks({
    documents: corpus.documents,
    chunks: corpus.chunks,
    graphEvidenceByDocumentId: graph.evidenceByDocumentId,
  })
  await mkdir(input.outputDirectory, { recursive: true })
  await Promise.all([
    writeFile(path.join(input.outputDirectory, 'snapshot.private.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8'),
    writeFile(path.join(input.outputDirectory, 'evidence-packs.private.jsonl'), jsonLines(evidencePacks), 'utf8'),
  ])
  try {
    await writeFile(path.join(input.outputDirectory, 'candidate-pool.private.jsonl'), '', { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return { snapshot, evidencePacks }
}

export function renderCandidateGenerationPrompt(pack: PrivateEvidencePack): string {
  return `你是地质知识问答私有评测集的候选题生成助手。\n\n`
    + `只能依据下方证据包生成候选题，不得使用证据之外的知识，不得虚构数值、地点、因果关系或实体。\n`
    + `不得把候选题直接标记为 accepted；annotationStatus 必须为 human_review。\n`
    + `不得输出文档标题、文件路径、API Key、完整报告或精确敏感坐标。\n`
    + `如果证据不能支持唯一事实，输出 rejected 候选并说明理由。\n\n`
    + `证据包：\n${JSON.stringify(pack, null, 2)}\n\n`
    + `输出 JSONL，每行一条符合 privateCandidateRecordSchema 的 single 候选记录。`
}

export function renderReviewedCandidatePrompts(packs: PrivateEvidencePack[]): Array<{
  evidencePackId: string
  prompt: string
}> {
  return packs.filter((pack) => pack.privacyReviewed === true).map((pack) => ({
    evidencePackId: pack.evidencePackId,
    prompt: renderCandidateGenerationPrompt(pack),
  }))
}

const SUPPORTED_PROMPT_CATEGORIES = [
  'document_fact', 'kg_relation', 'entity_detail', 'region_comparison', 'hybrid',
] as const
const MULTI_PROMPT_SCENARIOS = [
  'pronoun_followup', 'entity_comparison', 'entity_ambiguity', 'kg_followup', 'topic_switch',
] as const
type SupportedPromptCategory = typeof SUPPORTED_PROMPT_CATEGORIES[number]
type MultiPromptScenario = typeof MULTI_PROMPT_SCENARIOS[number]

export interface CandidatePrompt {
  promptId: string
  promptType: 'supported' | 'refusal' | 'multi'
  evidencePackIds: string[]
  supportedCategory?: SupportedPromptCategory
  scenario?: MultiPromptScenario
  prompt: string
}

export interface CandidatePromptBatchStats {
  evidencePackCount: number
  reviewedEvidencePackCount: number
  skippedEvidencePackCount: number
  coveredDocumentCount: number
  promptCount: number
  supportedCounts: Record<SupportedPromptCategory, number>
  refusalCount: number
  multiCount: number
  multiScenarioCounts: Record<MultiPromptScenario, number>
}

export interface CandidatePromptBatch {
  prompts: CandidatePrompt[]
  stats: CandidatePromptBatchStats
}

function ordered(packs: PrivateEvidencePack[]): PrivateEvidencePack[] {
  return [...packs].sort((left, right) =>
    left.documentFingerprint.localeCompare(right.documentFingerprint)
    || left.evidencePackId.localeCompare(right.evidencePackId))
}

function documentCount(packs: PrivateEvidencePack[]): number {
  return new Set(packs.map((pack) => pack.documentFingerprint)).size
}

function failCapacity(label: string, required: number, eligible: PrivateEvidencePack[]): never {
  throw new Error(capacityError(label, required, eligible))
}

function capacityError(label: string, required: number, eligible: PrivateEvidencePack[]): string {
  return `${label} requires ${required} prompts; available packs ${eligible.length}; `
    + `available documents ${documentCount(eligible)}.`
}

function capacityIssue(select: () => unknown): string | null {
  try {
    select()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function roundRobinByDocument(
  eligible: PrivateEvidencePack[],
  count: number,
  label: string,
): PrivateEvidencePack[] {
  if (eligible.length < count) failCapacity(label, count, eligible)
  const groups = new Map<string, PrivateEvidencePack[]>()
  for (const pack of ordered(eligible)) {
    groups.set(pack.documentFingerprint, [...(groups.get(pack.documentFingerprint) ?? []), pack])
  }
  const selected: PrivateEvidencePack[] = []
  for (let offset = 0; selected.length < count; offset += 1) {
    let added = false
    for (const group of groups.values()) {
      const pack = group[offset]
      if (!pack) continue
      selected.push(pack)
      added = true
      if (selected.length === count) break
    }
    if (!added) break
  }
  if (selected.length < count) failCapacity(label, count, eligible)
  return selected
}

function pairAcrossDocuments(
  eligible: PrivateEvidencePack[],
  count: number,
  label: string,
): Array<[PrivateEvidencePack, PrivateEvidencePack]> {
  if (eligible.length < count * 2 || documentCount(eligible) < 2) failCapacity(label, count, eligible)
  const remaining = roundRobinByDocument(eligible, eligible.length, label)
  const pairs: Array<[PrivateEvidencePack, PrivateEvidencePack]> = []
  while (pairs.length < count) {
    const first = remaining.shift()
    if (!first) failCapacity(label, count, eligible)
    const secondIndex = remaining.findIndex((pack) => pack.documentFingerprint !== first.documentFingerprint)
    if (secondIndex < 0) failCapacity(label, count, eligible)
    const [second] = remaining.splice(secondIndex, 1)
    pairs.push([first, second!])
  }
  return pairs
}

function hasText(pack: PrivateEvidencePack): boolean {
  return pack.supportingText.trim().length > 0
}

function hasPathEntities(pack: PrivateEvidencePack): boolean {
  const entityIds = new Set(pack.entities.map((entity) => entity.entityId))
  return pack.kgPaths.some((path) => entityIds.has(path.fromId) && entityIds.has(path.toId))
}

function hasAmbiguousEntityPair(pack: PrivateEvidencePack): boolean {
  return pack.entities.some((entity, index) => pack.entities.some((other, otherIndex) =>
    otherIndex > index && other.entityId !== entity.entityId && other.type === entity.type))
}

function supportedPrompt(
  category: SupportedPromptCategory,
  index: number,
  selected: PrivateEvidencePack[],
): CandidatePrompt {
  const categoryRules: Record<SupportedPromptCategory, string> = {
    document_fact: '生成一道只能由文献正文直接支持的事实题。',
    kg_relation: '生成一道只能由给定 kgPaths 直接支持的知识图谱关系题。',
    entity_detail: '生成一道围绕给定实体的详情题。',
    region_comparison: '生成一道比较两个不同文档所描述对象的题目，不得合并或臆造事实。',
    hybrid: '生成一道必须同时使用文献正文和 KG 路径才能完整回答的综合题。',
  }
  return {
    promptId: `supported-${category}-${String(index + 1).padStart(2, '0')}`,
    promptType: 'supported',
    supportedCategory: category,
    evidencePackIds: selected.map((pack) => pack.evidencePackId),
    prompt: `你是地质知识问答私有评测集的候选题生成助手。\n`
      + `${categoryRules[category]}\n`
      + `只能依据下列已人工脱敏且审核通过的证据包；annotationStatus 必须为 human_review，`
      + `不得标记为 accepted，不得补充外部知识。\n\n${JSON.stringify(selected, null, 2)}`,
  }
}

function multiPrompt(
  scenario: MultiPromptScenario,
  index: number,
  selected: PrivateEvidencePack[],
): CandidatePrompt {
  const scenarioNames: Record<MultiPromptScenario, string> = {
    pronoun_followup: '代词追问',
    entity_comparison: '双实体比较',
    entity_ambiguity: '实体歧义',
    kg_followup: 'KG关系追问',
    topic_switch: '中途换主题',
  }
  return {
    promptId: `multi-${scenario}-${String(index + 1).padStart(2, '0')}`,
    promptType: 'multi',
    scenario,
    evidencePackIds: selected.map((pack) => pack.evidencePackId),
    prompt: `仅依据下列已人工脱敏且审核通过的证据包，生成一组三轮对话候选，场景为“${scenarioNames[scenario]}”。\n`
      + `不得补充证据之外的地质知识；每轮必须填写 goldClaims/goldEvidence；annotationStatus 必须为 human_review，`
      + `不得标记为 accepted。\n\n${JSON.stringify(selected, null, 2)}`,
  }
}

export function buildCandidatePromptBatch(packs: PrivateEvidencePack[]): CandidatePromptBatch {
  const reviewed = ordered(packs.filter((pack) => pack.privacyReviewed === true))
  const categoryPools: Record<SupportedPromptCategory, PrivateEvidencePack[]> = {
    document_fact: reviewed.filter((pack) => hasText(pack) && pack.candidateCategories.includes('document_fact')),
    kg_relation: reviewed.filter((pack) => pack.kgPaths.length > 0),
    entity_detail: reviewed.filter((pack) => pack.entities.length > 0),
    region_comparison: reviewed.filter(hasText),
    hybrid: reviewed.filter((pack) => hasText(pack) && pack.kgPaths.length > 0),
  }
  const refusalPool = reviewed.filter(hasText)
  const entityPool = reviewed.filter((pack) => pack.entities.length > 0)
  const ambiguousEntityPool = reviewed.filter(hasAmbiguousEntityPair)
  const kgFollowupPool = reviewed.filter(hasPathEntities)
  const capacityIssues = [
    ...SUPPORTED_PROMPT_CATEGORIES.map((category) => capacityIssue(() => {
      if (category === 'region_comparison') pairAcrossDocuments(categoryPools[category], 11, category)
      else roundRobinByDocument(categoryPools[category], 11, category)
    })),
    capacityIssue(() => roundRobinByDocument(refusalPool, 15, 'refusal')),
    capacityIssue(() => roundRobinByDocument(entityPool, 3, 'pronoun_followup')),
    capacityIssue(() => pairAcrossDocuments(entityPool, 3, 'entity_comparison')),
    capacityIssue(() => roundRobinByDocument(ambiguousEntityPool, 3, 'entity_ambiguity')),
    capacityIssue(() => roundRobinByDocument(kgFollowupPool, 3, 'kg_followup')),
    capacityIssue(() => pairAcrossDocuments(entityPool, 3, 'topic_switch')),
  ].filter((issue): issue is string => issue !== null)
  if (capacityIssues.length > 0) {
    throw new Error(`Candidate prompt capacity check failed:\n${capacityIssues.join('\n')}`)
  }

  const supported: CandidatePrompt[] = []
  for (const category of SUPPORTED_PROMPT_CATEGORIES) {
    const selections = category === 'region_comparison'
      ? pairAcrossDocuments(categoryPools[category], 11, category)
      : roundRobinByDocument(categoryPools[category], 11, category).map((pack) => [pack])
    selections.forEach((selection, index) => supported.push(supportedPrompt(category, index, selection)))
  }

  const refusalPacks = roundRobinByDocument(refusalPool, 15, 'refusal')
  const refusal: CandidatePrompt[] = refusalPacks.map((pack, index) => ({
    promptId: `refusal-${String(index + 1).padStart(3, '0')}`,
    promptType: 'refusal',
    evidencePackIds: [pack.evidencePackId],
    prompt: `请基于以下已人工脱敏且审核通过的证据包，提出一道“可能无法回答”的拒答候选题。\n`
      + `你不能确认冻结知识库中不存在答案，annotationStatus 必须为 human_review，不得标记为 accepted；`
      + `必须要求人工执行全文、别名和知识图谱缺失检查。不得使用证据之外的知识。\n\n`
      + JSON.stringify(pack, null, 2),
  }))

  const multiSelections: Record<MultiPromptScenario, PrivateEvidencePack[][]> = {
    pronoun_followup: roundRobinByDocument(entityPool, 3, 'pronoun_followup').map((pack) => [pack]),
    entity_comparison: pairAcrossDocuments(entityPool, 3, 'entity_comparison'),
    entity_ambiguity: roundRobinByDocument(ambiguousEntityPool, 3, 'entity_ambiguity').map((pack) => [pack]),
    kg_followup: roundRobinByDocument(kgFollowupPool, 3, 'kg_followup').map((pack) => [pack]),
    topic_switch: pairAcrossDocuments(entityPool, 3, 'topic_switch'),
  }
  const multi: CandidatePrompt[] = MULTI_PROMPT_SCENARIOS.flatMap((scenario) =>
    multiSelections[scenario].map((selection, index) => multiPrompt(scenario, index, selection)))

  const prompts = [...supported, ...refusal, ...multi]
  const stats: CandidatePromptBatchStats = {
    evidencePackCount: packs.length,
    reviewedEvidencePackCount: reviewed.length,
    skippedEvidencePackCount: packs.length - reviewed.length,
    coveredDocumentCount: documentCount(reviewed),
    promptCount: prompts.length,
    supportedCounts: Object.fromEntries(SUPPORTED_PROMPT_CATEGORIES.map((category) => [
      category, supported.filter((prompt) => prompt.supportedCategory === category).length,
    ])) as Record<SupportedPromptCategory, number>,
    refusalCount: refusal.length,
    multiCount: multi.length,
    multiScenarioCounts: Object.fromEntries(MULTI_PROMPT_SCENARIOS.map((scenario) => [
      scenario, multi.filter((prompt) => prompt.scenario === scenario).length,
    ])) as Record<MultiPromptScenario, number>,
  }
  return { prompts, stats }
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const REVIEW_HEADERS = [
  'candidate_id', 'record_type', 'kind', 'question', 'category', 'difficulty',
  'expected_intent', 'expected_tools', 'evidence_pack_ids', 'document_fingerprints',
  'pages', 'chunk_ids', 'supporting_text', 'entity_count', 'kg_path_count',
  'privacy_reviewed', 'review_status', 'reviewer', 'review_notes', 'unanswerable_reason', 'record_json',
]

export function renderCandidateReviewCsv(records: PrivateCandidateRecord[], packs: PrivateEvidencePack[]): string {
  const rows = records.map((record) => {
    const single = record.recordType === 'single' ? record : null
    const multi = record.recordType === 'multi' ? record : null
    const evidence = single ? single.goldEvidence : multi!.turns.flatMap((turn) => turn.goldEvidence)
    const selected = packs.filter((pack) => evidence.some((item) =>
      (item.documentFingerprint === pack.documentFingerprint && (!item.page || item.page === pack.page)) ||
      Boolean(item.kgPath && pack.kgPaths.some((kgPath) => kgPath.fromId === item.kgPath?.fromId && kgPath.relation === item.kgPath?.relation && kgPath.toId === item.kgPath?.toId))))
    return [record.id, record.recordType, single?.kind ?? 'multi', single?.question ?? multi?.turns[0]?.question ?? '', single?.category ?? multi?.scenario ?? '',
      single?.difficulty ?? '', single?.expectedIntent ?? multi?.turns[0]?.expectedIntent ?? '', single?.expectedTools.join('|') ?? multi?.turns[0]?.expectedTools.join('|') ?? '',
      selected.map((pack) => pack.evidencePackId).join('|'), selected.map((pack) => pack.documentFingerprint).join('|'), selected.map((pack) => pack.page).join('|'), selected.flatMap((pack) => pack.chunkIds).join('|'),
      selected.map((pack) => pack.supportingText).join('\n---\n'), selected.reduce((sum, pack) => sum + pack.entities.length, 0), selected.reduce((sum, pack) => sum + pack.kgPaths.length, 0), selected.every((pack) => pack.privacyReviewed),
      record.annotationStatus, record.reviewer ?? '', record.reviewNotes ?? '', single?.unanswerableReason ?? '', JSON.stringify(record),
    ].map(csvCell).join(',')
  })
  return `${REVIEW_HEADERS.join(',')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i]
    if (quoted) { if (char === '"' && content[i + 1] === '"') { cell += '"'; i += 1 } else if (char === '"') quoted = false; else cell += char; continue }
    if (char === '"' && cell.length === 0) { quoted = true; continue }
    if (char === ',') { row.push(cell); cell = ''; continue }
    if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; continue }
    cell += char
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

export function parseCandidateReviewCsv(content: string): PrivateCandidateRecord[] {
  const rows = parseCsv(content); const headers = rows.shift() ?? []
  const index = new Map(headers.map((header, position) => [header, position])); const jsonIndex = index.get('record_json')
  if (jsonIndex == null) throw new Error('Candidate review CSV is missing record_json.')
  const ids = new Set<string>()
  return rows.filter((row) => row.some(Boolean)).map((row, rowIndex) => {
    let record: PrivateCandidateRecord
    try { record = privateCandidateRecordSchema.parse(JSON.parse(row[jsonIndex] ?? '')) } catch (error) { throw new Error(`Invalid candidate review CSV at row ${rowIndex + 2}: ${error instanceof Error ? error.message : String(error)}`) }
    const csvId = row[index.get('candidate_id') ?? -1]
    if (!csvId || csvId !== record.id) throw new Error(`Candidate review CSV ID mismatch at row ${rowIndex + 2}.`)
    if (ids.has(record.id)) throw new Error(`Duplicate candidate ID: ${record.id}`)
    ids.add(record.id)
    const status = row[index.get('review_status') ?? -1] || record.annotationStatus
    const reviewer = row[index.get('reviewer') ?? -1] || undefined
    const notes = row[index.get('review_notes') ?? -1] || undefined
    if (status === 'accepted' && !reviewer) {
      throw new Error(`Accepted candidate ${record.id} requires a human reviewer.`)
    }
    const updated = privateCandidateRecordSchema.parse({ ...record, annotationStatus: status, reviewer, reviewNotes: notes })
    if (updated.recordType === 'single' && updated.kind === 'refusal' && updated.annotationStatus === 'accepted' &&
      (!updated.unanswerableReason || !updated.absenceChecks.includes('full_text') || !updated.absenceChecks.includes('knowledge_graph'))) {
      throw new Error(`Accepted refusal ${updated.id} requires full_text and knowledge_graph absence checks.`)
    }
    return updated
  })
}
