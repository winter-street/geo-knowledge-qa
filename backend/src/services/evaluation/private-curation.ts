import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalDocumentFingerprint } from './document-fingerprint.js'
import {
  privateEvaluationSuiteSchema,
  type PrivateQualitySuite,
} from './private-quality.js'

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/)
const intentSchema = z.enum([
  'geology_qa', 'entity_lookup', 'spatial_analysis',
  'region_comparison', 'chitchat', 'clarification',
])
const toolSchema = z.enum([
  'search_documents', 'query_knowledge_graph', 'spatial_query', 'get_entity_detail',
])
const outcomeSchema = z.enum(['answered', 'clarification_required', 'refused'])
const entityTypeSchema = z.enum(['Mineral', 'Rock', 'Structure', 'TimePeriod', 'DepositType', 'Region'])
const annotationStatusSchema = z.enum(['candidate', 'accepted', 'rejected', 'human_review'])

export interface CurationDocument {
  id: number
  title: string
  docType: string | null
  totalPages: number | null
}

export interface CurationChunk {
  id: number
  docId: number
  page: number
  chunkIndex: number
  text: string
}

export interface PrivateGraphSnapshot {
  available: boolean
  nodeCount: number
  relationshipCount: number
  entityIds: string[]
}

export interface PrivateDataSnapshot {
  schemaVersion: '1.0'
  private: true
  frozenAt: string
  sqliteSha256: string
  documentCount: number
  uniqueDocumentCount: number
  chunkCount: number
  graph: PrivateGraphSnapshot
  documents: Array<{ documentId: number; fingerprint: string; chunkCount: number }>
  duplicateDocumentGroups: Array<{ fingerprint: string; documentIds: number[] }>
  snapshotHash: string
}

export interface PrivateEvidencePack {
  evidencePackId: string
  documentFingerprint: string
  page: number
  chunkIds: number[]
  supportingText: string
  entities: Array<{ entityId: string; name: string; type: z.infer<typeof entityTypeSchema> }>
  kgPaths: Array<{ fromId: string; relation: string; toId: string }>
  candidateCategories: Array<'document_fact' | 'kg_relation' | 'entity_detail'>
  spatialEligible: boolean
  privacyReviewed: boolean
}

export const privateEvidencePackSchema = z.object({
  evidencePackId: z.string().regex(/^ep-\d{4,}$/),
  documentFingerprint: fingerprintSchema,
  page: z.number().int().positive(),
  chunkIds: z.array(z.number().int().positive()).min(1),
  supportingText: z.string().min(1),
  entities: z.array(z.object({
    entityId: z.string().min(1),
    name: z.string().min(1),
    type: entityTypeSchema,
  })),
  kgPaths: z.array(z.object({
    fromId: z.string().min(1),
    relation: z.string().min(1),
    toId: z.string().min(1),
  })),
  candidateCategories: z.array(z.enum([
    'document_fact', 'kg_relation', 'entity_detail',
  ])).min(1),
  spatialEligible: z.boolean(),
  privacyReviewed: z.boolean(),
})

const goldEvidenceSchema = z.object({
  documentFingerprint: fingerprintSchema.optional(),
  page: z.number().int().positive().optional(),
  supportingText: z.string().min(1).optional(),
  kgPath: z.object({ fromId: z.string().min(1), relation: z.string().min(1), toId: z.string().min(1) }).optional(),
}).refine((value) => value.documentFingerprint || value.kgPath, 'Gold evidence requires a document or KG path.')

const reviewedTurnSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  expectedIntent: intentSchema,
  expectedTools: z.array(toolSchema).max(3),
  relevantDocumentFingerprints: z.array(fingerprintSchema),
  acceptedEntityIds: z.array(z.string().min(1)),
  expectedOutcome: outcomeSchema,
  goldClaims: z.array(z.string().min(1)),
  goldEvidence: z.array(goldEvidenceSchema),
})

const commonReviewSchema = z.object({
  id: z.string().min(1),
  generatedByAi: z.boolean(),
  annotationStatus: annotationStatusSchema,
  reviewer: z.string().min(1).optional(),
  reviewNotes: z.string().optional(),
})

export const privateCandidateRecordSchema = z.discriminatedUnion('recordType', [
  commonReviewSchema.extend({
    recordType: z.literal('single'),
    kind: z.enum(['supported', 'refusal']),
    question: z.string().min(1),
    category: z.string().min(1),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    expectedIntent: intentSchema,
    expectedTools: z.array(toolSchema).max(3),
    expectedOutcome: outcomeSchema,
    relevantDocumentFingerprints: z.array(fingerprintSchema),
    acceptedEntityIds: z.array(z.string().min(1)),
    goldClaims: z.array(z.string().min(1)),
    goldEvidence: z.array(goldEvidenceSchema),
    unanswerableReason: z.string().min(1).nullable(),
    absenceChecks: z.array(z.enum(['full_text', 'knowledge_graph', 'aliases'])),
  }),
  commonReviewSchema.extend({
    recordType: z.literal('multi'),
    scenario: z.enum([
      'pronoun_followup', 'entity_comparison', 'entity_ambiguity',
      'kg_followup', 'topic_switch',
    ]),
    turns: z.array(reviewedTurnSchema).length(3),
  }),
])

export type PrivateCandidateRecord = z.infer<typeof privateCandidateRecordSchema>

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}

function groupedChunks(chunks: CurationChunk[]): Map<number, CurationChunk[]> {
  const groups = new Map<number, CurationChunk[]>()
  for (const chunk of chunks) groups.set(chunk.docId, [...(groups.get(chunk.docId) ?? []), chunk])
  return groups
}

export function createPrivateSnapshot(input: {
  sqliteSha256: string
  documents: CurationDocument[]
  chunks: CurationChunk[]
  graph: PrivateGraphSnapshot
  frozenAt: string
}): PrivateDataSnapshot {
  const groups = groupedChunks(input.chunks)
  const documents = input.documents.flatMap((document) => {
    const chunks = groups.get(document.id) ?? []
    if (chunks.length === 0) return []
    return [{
      documentId: document.id,
      fingerprint: canonicalDocumentFingerprint(chunks.map((chunk) => ({
        page: chunk.page, chunkIndex: chunk.chunkIndex, text: chunk.text,
      }))),
      chunkCount: chunks.length,
    }]
  })
  const documentsByFingerprint = new Map<string, typeof documents>()
  for (const document of documents) {
    documentsByFingerprint.set(document.fingerprint, [
      ...(documentsByFingerprint.get(document.fingerprint) ?? []),
      document,
    ])
  }
  const duplicateDocumentGroups = [...documentsByFingerprint]
    .filter(([, values]) => values.length > 1)
    .map(([fingerprint, values]) => ({ fingerprint, documentIds: values.map((value) => value.documentId) }))
  const base = {
    schemaVersion: '1.0' as const,
    private: true as const,
    frozenAt: input.frozenAt,
    sqliteSha256: fingerprintSchema.parse(input.sqliteSha256),
    documentCount: input.documents.length,
    uniqueDocumentCount: new Set(documents.map((document) => document.fingerprint)).size,
    chunkCount: input.chunks.length,
    graph: { ...input.graph, entityIds: [...new Set(input.graph.entityIds)].sort() },
    documents,
    duplicateDocumentGroups,
  }
  return { ...base, snapshotHash: hashJson(base) }
}

const LOW_QUALITY = /(^|[\s：:])(致谢|参考文献|目录|contents|acknowledg(e)?ments?)([\s：:]|$)/i

export function evidenceTextQuality(text: string): { accepted: boolean; normalized: string } {
  const normalized = normalize(text)
  if (normalized.length < 45 || LOW_QUALITY.test(normalized)) return { accepted: false, normalized }
  if (!/[。！？；.!?;](?:[」』”’）)\]】〕〉》]*)$/.test(normalized)) return { accepted: false, normalized }
  const replacementCount = (normalized.match(/[�□]/g) ?? []).length
  const readableCount = (normalized.match(/[\p{L}\p{N}\p{P}\p{Zs}]/gu) ?? []).length
  if (replacementCount > 0 || readableCount / Math.max(1, normalized.length) < 0.85) return { accepted: false, normalized }
  return { accepted: true, normalized }
}

export function validatePrivateSnapshot(snapshot: PrivateDataSnapshot): void {
  const { snapshotHash, ...base } = snapshot
  if (!fingerprintSchema.safeParse(snapshot.sqliteSha256).success) {
    throw new Error('Private snapshot contains an invalid SQLite SHA-256.')
  }
  if (snapshotHash !== hashJson(base)) throw new Error('Private snapshot hash mismatch.')
}

export function buildEvidencePacks(input: {
  documents: CurationDocument[]
  chunks: CurationChunk[]
  graphEvidenceByDocumentId?: Map<number, {
    entities: PrivateEvidencePack['entities']
    kgPaths: PrivateEvidencePack['kgPaths']
    spatialEligible: boolean
  }>
}): PrivateEvidencePack[] {
  const groups = groupedChunks(input.chunks)
  const seenFingerprints = new Set<string>()
  const packs: PrivateEvidencePack[] = []
  for (const document of [...input.documents].sort((a, b) => a.id - b.id)) {
    const documentChunks = groups.get(document.id) ?? []
    if (documentChunks.length === 0) continue
    const fingerprint = canonicalDocumentFingerprint(documentChunks.map((chunk) => ({
      page: chunk.page, chunkIndex: chunk.chunkIndex, text: chunk.text,
    })))
    if (seenFingerprints.has(fingerprint)) continue
    seenFingerprints.add(fingerprint)
    const graph = input.graphEvidenceByDocumentId?.get(document.id)
    for (const chunk of documentChunks) {
      const quality = evidenceTextQuality(chunk.text)
      if (!quality.accepted) continue
      const entities = (graph?.entities ?? []).filter((entity) => {
        const name = normalize(entity.name)
        return name.length >= 2 && quality.normalized.includes(name)
      })
      const entityIds = new Set(entities.map((entity) => entity.entityId))
      const kgPaths = (graph?.kgPaths ?? []).filter((path) =>
        entityIds.has(path.fromId) && entityIds.has(path.toId))
      const spatialEligible = Boolean(graph?.spatialEligible && entities.length > 0)
      const categories: PrivateEvidencePack['candidateCategories'] = ['document_fact']
      if (kgPaths.length > 0) categories.push('kg_relation')
      else if (entities.length > 0) categories.push('entity_detail')
      packs.push({
        evidencePackId: `ep-${String(packs.length + 1).padStart(4, '0')}`,
        documentFingerprint: fingerprint,
        page: chunk.page,
        chunkIds: [chunk.id],
        supportingText: quality.normalized,
        entities,
        kgPaths,
        candidateCategories: categories,
        spatialEligible,
        privacyReviewed: false,
      })
    }
  }
  return packs
}

function accepted(record: PrivateCandidateRecord): boolean {
  return record.annotationStatus === 'accepted' && Boolean(record.reviewer)
}

export function buildFrozenPrivateSuite(input: {
  label: string
  frozenAt: string
  records: PrivateCandidateRecord[]
  snapshot: PrivateDataSnapshot
}): PrivateQualitySuite {
  if (!input.snapshot.graph.available) {
    throw new Error('A complete Neo4j snapshot is required before freezing the private suite.')
  }
  const records = input.records.map((record) => privateCandidateRecordSchema.parse(record)).filter(accepted)
  const suite = privateEvaluationSuiteSchema.parse({
    schemaVersion: '1.0', private: true, label: input.label, frozenAt: input.frozenAt,
    singleTurnCases: records.flatMap((record) => record.recordType === 'single' ? [{
      id: record.id, kind: record.kind, question: record.question,
      expectedIntent: record.expectedIntent, expectedTools: record.expectedTools,
      relevantDocumentFingerprints: record.relevantDocumentFingerprints,
      acceptedEntityIds: record.acceptedEntityIds, expectedOutcome: record.expectedOutcome,
    }] : []),
    multiTurnCases: records.flatMap((record) => record.recordType === 'multi' ? [{
      id: record.id,
      turns: record.turns.map((turn) => ({
        id: turn.id, question: turn.question, expectedIntent: turn.expectedIntent,
        expectedTools: turn.expectedTools,
        relevantDocumentFingerprints: turn.relevantDocumentFingerprints,
        acceptedEntityIds: turn.acceptedEntityIds, expectedOutcome: turn.expectedOutcome,
      })),
    }] : []),
  })
  validateFrozenSuiteReferences(suite, input.snapshot)
  return suite
}

export function validateFrozenSuiteReferences(suite: PrivateQualitySuite, snapshot: PrivateDataSnapshot): void {
  privateEvaluationSuiteSchema.parse(suite)
  const fingerprints = new Set(snapshot.documents.map((document) => document.fingerprint))
  const entityIds = new Set(snapshot.graph.entityIds)
  const turns = [...suite.singleTurnCases, ...suite.multiTurnCases.flatMap((group) => group.turns)]
  for (const turn of turns) {
    for (const fingerprint of turn.relevantDocumentFingerprints) {
      if (!fingerprints.has(fingerprint)) throw new Error(`Unknown document fingerprint in ${turn.id}: ${fingerprint}`)
    }
    for (const entityId of turn.acceptedEntityIds) {
      if (!entityIds.has(entityId)) throw new Error(`Unknown entity ID in ${turn.id}: ${entityId}`)
    }
  }
  for (const item of suite.singleTurnCases.filter((item) => item.kind === 'refusal')) {
    if (item.relevantDocumentFingerprints.length > 0) {
      throw new Error(`Refusal case ${item.id} must not include relevant document fingerprints.`)
    }
  }
  const supported = suite.singleTurnCases.filter((item) => item.kind === 'supported')
  const counts = new Map<string, number>()
  for (const item of supported) {
    for (const fingerprint of new Set(item.relevantDocumentFingerprints)) {
      counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1)
    }
  }
  const maximum = Math.floor(supported.length * 0.2)
  for (const [fingerprint, count] of counts) {
    if (count > maximum) throw new Error(`Document fingerprint ${fingerprint} exceeds the 20% supported-case cap.`)
  }
}
