import {
  privateCandidateRecordSchema,
  type PrivateCandidateRecord,
  type PrivateEvidencePack,
} from './private-curation.js'
import path from 'node:path'

const SUPPORTED_CATEGORIES = [
  'document_fact', 'kg_relation', 'entity_detail',
  'region_comparison', 'hybrid',
] as const
const REFUSAL_CATEGORIES = [
  'refusal_numeric_missing', 'refusal_future_information', 'refusal_false_premise',
  'refusal_relation_missing', 'refusal_out_of_scope',
] as const
const MULTI_SCENARIOS = [
  'pronoun_followup', 'entity_comparison', 'entity_ambiguity',
  'kg_followup', 'topic_switch',
] as const
const FORBIDDEN_SUITE_FIELDS = [
  'supportingText', 'goldClaims', 'goldEvidence', 'reviewNotes', 'reviewer',
  'title', 'path', 'coordinates', 'longitude', 'latitude', 'page',
]

export function parsePrivateCandidateJsonLines(content: string): PrivateCandidateRecord[] {
  const records: PrivateCandidateRecord[] = []
  const ids = new Set<string>()
  for (const [index, raw] of content.split(/\r?\n/).entries()) {
    if (!raw.trim()) continue
    try {
      const record = privateCandidateRecordSchema.parse(JSON.parse(raw))
      if (ids.has(record.id)) throw new Error(`Duplicate candidate ID: ${record.id}`)
      ids.add(record.id)
      records.push(record)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Invalid candidate JSONL at line ${index + 1}: ${message}`)
    }
  }
  return records
}

function accepted(records: PrivateCandidateRecord[]): PrivateCandidateRecord[] {
  return records.filter((record) => record.annotationStatus === 'accepted')
}

export function validateAcceptedCurationRecords(records: PrivateCandidateRecord[]): void {
  const reviewed = accepted(records.map((record) => privateCandidateRecordSchema.parse(record)))
  for (const record of reviewed) {
    if (!record.reviewer) throw new Error(`Accepted record ${record.id} requires a human reviewer.`)
  }
  const singles = reviewed.filter((record): record is Extract<PrivateCandidateRecord, { recordType: 'single' }> =>
    record.recordType === 'single')
  const multis = reviewed.filter((record): record is Extract<PrivateCandidateRecord, { recordType: 'multi' }> =>
    record.recordType === 'multi')
  const supported = singles.filter((record) => record.kind === 'supported')
  const refusals = singles.filter((record) => record.kind === 'refusal')
  if (supported.length !== 30 || refusals.length !== 10 || multis.length !== 10) {
    throw new Error('Accepted records must contain exactly 30 supported, 10 refusal and 10 multi-turn groups.')
  }
  for (const category of SUPPORTED_CATEGORIES) {
    if (!supported.some((record) => record.category === category)) {
      throw new Error(`Missing supported category coverage: ${category}`)
    }
  }
  const requiredTools: Partial<Record<(typeof SUPPORTED_CATEGORIES)[number], string[]>> = {
    document_fact: ['search_documents'],
    kg_relation: ['query_knowledge_graph'],
    entity_detail: ['get_entity_detail'],
    hybrid: ['search_documents', 'query_knowledge_graph'],
  }
  for (const record of supported) {
    if (record.goldClaims.length === 0 || record.goldEvidence.length === 0) {
      throw new Error(`Supported record ${record.id} requires gold claims and gold evidence.`)
    }
    const relevantDocuments = new Set(record.relevantDocumentFingerprints)
    const acceptedEntities = new Set(record.acceptedEntityIds)
    for (const evidence of record.goldEvidence) {
      if (evidence.documentFingerprint && !relevantDocuments.has(evidence.documentFingerprint)) {
        throw new Error(`Gold evidence for ${record.id} must map to a relevant document fingerprint.`)
      }
      if (evidence.kgPath &&
        (!acceptedEntities.has(evidence.kgPath.fromId) && !acceptedEntities.has(evidence.kgPath.toId))) {
        throw new Error(`Gold evidence for ${record.id} must map to an accepted entity ID.`)
      }
    }
    for (const tool of requiredTools[record.category as (typeof SUPPORTED_CATEGORIES)[number]] ?? []) {
      if (!record.expectedTools.includes(tool as typeof record.expectedTools[number])) {
        throw new Error(`${record.category} record ${record.id} requires ${requiredTools[record.category as (typeof SUPPORTED_CATEGORIES)[number]]!.join(' and ')}.`)
      }
    }
  }
  for (const category of REFUSAL_CATEGORIES) {
    if (!refusals.some((record) => record.category === category)) {
      throw new Error(`Missing refusal category coverage: ${category}`)
    }
  }
  for (const scenario of MULTI_SCENARIOS) {
    if (!multis.some((record) => record.scenario === scenario)) {
      throw new Error(`Missing multi-turn scenario coverage: ${scenario}`)
    }
  }
  const difficulties = new Map<'easy' | 'medium' | 'hard', number>([
    ['easy', 0], ['medium', 0], ['hard', 0],
  ])
  for (const record of singles) difficulties.set(record.difficulty, difficulties.get(record.difficulty)! + 1)
  const ranges = { easy: [8, 14], medium: [17, 23], hard: [5, 10] } as const
  for (const [level, [minimum, maximum]] of Object.entries(ranges)) {
    const count = difficulties.get(level as 'easy' | 'medium' | 'hard') ?? 0
    if (count < minimum || count > maximum) {
      throw new Error(`Difficulty distribution for ${level} is ${count}; expected ${minimum}-${maximum}.`)
    }
  }
  for (const refusal of refusals) {
    if (!refusal.unanswerableReason?.trim()) {
      throw new Error(`Refusal ${refusal.id} requires unanswerableReason.`)
    }
    for (const check of ['full_text', 'knowledge_graph'] as const) {
      if (!refusal.absenceChecks.includes(check)) {
        throw new Error(`Refusal ${refusal.id} requires ${check} absence check.`)
      }
    }
  }
}

export function validateAcceptedEvidenceReferences(
  records: PrivateCandidateRecord[],
  evidencePacks: PrivateEvidencePack[],
): void {
  const reviewedPacks = evidencePacks.filter((pack) => pack.privacyReviewed)
  const documentEvidence = new Set(reviewedPacks.map((pack) => `${pack.documentFingerprint}:${pack.page}`))
  const kgEvidence = new Set(reviewedPacks.flatMap((pack) => pack.kgPaths.map((kgPath) =>
    `${kgPath.fromId}:${kgPath.relation}:${kgPath.toId}`)))
  const reviewed = accepted(records)
  const evidence = reviewed.flatMap((record) => record.recordType === 'single'
    ? record.goldEvidence
    : record.turns.flatMap((turn) => turn.goldEvidence))
  for (const item of evidence) {
    if (item.documentFingerprint && item.page &&
      !documentEvidence.has(`${item.documentFingerprint}:${item.page}`)) {
      throw new Error(`Gold evidence page ${item.page} does not map to a privacy-reviewed evidence pack.`)
    }
    if (item.kgPath && !kgEvidence.has(`${item.kgPath.fromId}:${item.kgPath.relation}:${item.kgPath.toId}`)) {
      throw new Error('Gold KG path does not map to a privacy-reviewed evidence pack.')
    }
  }
}

export function assertFrozenSuitePrivacy(suite: unknown): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_SUITE_FIELDS.includes(key)) throw new Error(`Forbidden field in frozen suite: ${key}`)
      visit(child)
    }
  }
  visit(suite)
  const serialized = JSON.stringify(suite)
  if (/[A-Za-z]:\\|\.pdf(?:"|\s|$)|(?:api[_-]?key|password)\s*[:=]/i.test(serialized)) {
    throw new Error('Frozen suite contains a private path, PDF reference or credential-like value.')
  }
}

export type CurationCommand =
  | { command: 'export'; dbPath: string; outputDirectory: string; allowMissingNeo4j: boolean }
  | { command: 'prompts'; evidencePath: string; outputPath: string }
  | { command: 'review-export'; candidatePath: string; evidencePath: string; outputPath: string }
  | { command: 'review-import'; csvPath: string; outputPath: string }
  | { command: 'validate'; candidatePath: string; snapshotPath: string; evidencePath: string }
  | { command: 'freeze'; candidatePath: string; snapshotPath: string; evidencePath: string; outputPath: string; label: string }

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function requiredFlag(args: string[], name: string): string {
  const value = flag(args, name)
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`)
  return value
}

export function resolveCurationPath(value: string, backendRoot: string, repositoryRoot: string): string {
  if (path.isAbsolute(value)) return path.resolve(value)
  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('backend/')) return path.resolve(repositoryRoot, normalized)
  if (normalized.startsWith('ml-service/') || normalized.startsWith('data/')) {
    return path.resolve(repositoryRoot, normalized)
  }
  return path.resolve(backendRoot, normalized)
}

export function assertPrivateEvaluationOutputPath(outputPath: string, backendRoot: string): void {
  const privateRoot = path.resolve(backendRoot, 'evaluation/private')
  const resolved = path.resolve(outputPath)
  if (resolved !== privateRoot && !resolved.startsWith(privateRoot + path.sep)) {
    throw new Error('Private curation output must stay inside backend/evaluation/private/.')
  }
}

export function parseCurationCommand(args: string[]): CurationCommand {
  const command = args[0]
  if (command === 'export') {
    return {
      command,
      dbPath: requiredFlag(args, '--db'),
      outputDirectory: requiredFlag(args, '--output'),
      allowMissingNeo4j: args.includes('--allow-missing-neo4j'),
    }
  }
  if (command === 'validate') {
    return {
      command,
      candidatePath: requiredFlag(args, '--candidates'),
      snapshotPath: requiredFlag(args, '--snapshot'),
      evidencePath: requiredFlag(args, '--evidence'),
    }
  }
  if (command === 'prompts') {
    return {
      command,
      evidencePath: requiredFlag(args, '--evidence'),
      outputPath: requiredFlag(args, '--output'),
    }
  }
  if (command === 'review-export') {
    return {
      command,
      candidatePath: requiredFlag(args, '--candidates'),
      evidencePath: requiredFlag(args, '--evidence'),
      outputPath: requiredFlag(args, '--output'),
    }
  }
  if (command === 'review-import') {
    return {
      command,
      csvPath: requiredFlag(args, '--csv'),
      outputPath: requiredFlag(args, '--output'),
    }
  }
  if (command === 'freeze') {
    return {
      command,
      candidatePath: requiredFlag(args, '--candidates'),
      snapshotPath: requiredFlag(args, '--snapshot'),
      evidencePath: requiredFlag(args, '--evidence'),
      outputPath: requiredFlag(args, '--output'),
      label: requiredFlag(args, '--label'),
    }
  }
  throw new Error('Usage: evaluation:curate <export|prompts|validate|freeze> [options]')
}
