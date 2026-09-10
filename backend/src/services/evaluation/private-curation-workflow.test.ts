import assert from 'node:assert/strict'
import {
  buildFrozenPrivateSuite,
  createPrivateSnapshot,
  privateCandidateRecordSchema,
} from './private-curation.js'
import {
  assertFrozenSuitePrivacy,
  assertPrivateEvaluationOutputPath,
  parseCurationCommand,
  parsePrivateCandidateJsonLines,
  resolveCurationPath,
  validateAcceptedEvidenceReferences,
  validateAcceptedCurationRecords,
} from './private-curation-workflow.js'

const documents = Array.from({ length: 5 }, (_, index) => ({
  id: index + 1,
  title: `private-${index + 1}`,
  docType: 'report',
  totalPages: 1,
}))
const chunks = documents.map((document) => ({
  id: document.id,
  docId: document.id,
  page: 1,
  chunkIndex: 0,
  text: `测试文档${document.id}包含一条完整且可独立核验的地质事实。该句仅用于冻结流程测试，不代表任何真实地点或调查结论。`,
}))
const snapshot = createPrivateSnapshot({
  sqliteSha256: 'a'.repeat(64),
  documents,
  chunks,
  graph: { available: true, nodeCount: 3, relationshipCount: 2, entityIds: ['entity-1'] },
  frozenAt: '2026-08-12T00:00:00.000Z',
})

const supportedCategories = [
  'document_fact', 'kg_relation', 'entity_detail',
  'region_comparison', 'hybrid',
]
const refusalCategories = [
  'refusal_numeric_missing', 'refusal_future_information', 'refusal_false_premise',
  'refusal_relation_missing', 'refusal_out_of_scope',
]
const scenarios = [
  'pronoun_followup', 'entity_comparison', 'entity_ambiguity',
  'kg_followup', 'topic_switch',
] as const

function difficulty(index: number): 'easy' | 'medium' | 'hard' {
  return index < 12 ? 'easy' : index < 32 ? 'medium' : 'hard'
}

const singles = Array.from({ length: 40 }, (_, index) => {
  const supported = index < 30
  const category = supported
    ? supportedCategories[index % supportedCategories.length]
    : refusalCategories[(index - 30) % refusalCategories.length]
  const fingerprint = snapshot.documents[index % 5]!.fingerprint
  return privateCandidateRecordSchema.parse({
    recordType: 'single',
    id: `single-${index + 1}`,
    kind: supported ? 'supported' : 'refusal',
    question: `private question ${index + 1}`,
    category,
    difficulty: difficulty(index),
    expectedIntent: supported && index % 5 === 3 ? 'region_comparison' : 'geology_qa',
    expectedTools: !supported ? ['search_documents', 'query_knowledge_graph']
      : category === 'kg_relation' ? ['query_knowledge_graph']
      : category === 'entity_detail' ? ['get_entity_detail']
      : category === 'hybrid' ? ['search_documents', 'query_knowledge_graph']
      : ['search_documents'],
    expectedOutcome: supported ? 'answered' : 'refused',
    relevantDocumentFingerprints: supported ? [fingerprint] : [],
    acceptedEntityIds: supported ? ['entity-1'] : [],
    goldClaims: supported ? [`gold claim ${index + 1}`] : [],
    goldEvidence: supported ? [{ documentFingerprint: fingerprint, page: 1, supportingText: 'private evidence' }] : [],
    unanswerableReason: supported ? null : 'Frozen corpus has no supporting evidence after full checks.',
    absenceChecks: supported ? [] : ['full_text', 'knowledge_graph', 'aliases'],
    generatedByAi: true,
    annotationStatus: 'accepted',
    reviewer: 'human-reviewer',
  })
})

const multis = Array.from({ length: 10 }, (_, index) => privateCandidateRecordSchema.parse({
  recordType: 'multi',
  id: `multi-${index + 1}`,
  scenario: scenarios[index % scenarios.length],
  annotationStatus: 'accepted',
  reviewer: 'human-reviewer',
  generatedByAi: true,
  turns: Array.from({ length: 3 }, (_, turnIndex) => ({
    id: `multi-${index + 1}-turn-${turnIndex + 1}`,
    question: `private multi question ${index + 1}-${turnIndex + 1}`,
    expectedIntent: 'entity_lookup',
    expectedTools: ['get_entity_detail'],
    relevantDocumentFingerprints: [snapshot.documents[index % 5]!.fingerprint],
    acceptedEntityIds: ['entity-1'],
    expectedOutcome: 'answered',
    goldClaims: ['private supported claim'],
    goldEvidence: [{
      documentFingerprint: snapshot.documents[index % 5]!.fingerprint,
      page: 1,
      supportingText: 'private evidence',
    }],
  })),
}))

const records = [...singles, ...multis]
assert.doesNotThrow(() => validateAcceptedCurationRecords(records))
assert.throws(() => buildFrozenPrivateSuite({
  label: 'document-only-invalid',
  frozenAt: snapshot.frozenAt,
  records,
  snapshot: { ...snapshot, graph: { available: false, nodeCount: 0, relationshipCount: 0, entityIds: [] } },
}), /Neo4j snapshot/i)
const jsonl = records.map((record) => JSON.stringify(record)).join('\n')
assert.equal(parsePrivateCandidateJsonLines(jsonl).length, 50)
assert.throws(
  () => parsePrivateCandidateJsonLines(`${JSON.stringify(records[0])}\n${JSON.stringify(records[0])}`),
  /duplicate candidate ID/i,
)
assert.throws(
  () => parsePrivateCandidateJsonLines(`${JSON.stringify(records[0])}\n{"recordType":"single"}`),
  /line 2/i,
)

const noHybrid = records.map((record) => record.recordType === 'single' && record.category === 'hybrid'
  ? { ...record, category: 'document_fact' }
  : record)
assert.throws(() => validateAcceptedCurationRecords(noHybrid), /supported category.*hybrid/i)

const invalidHybrid = records.map((record) => record.recordType === 'single' && record.category === 'hybrid'
  ? { ...record, expectedTools: ['search_documents'] as const }
  : record)
assert.throws(() => validateAcceptedCurationRecords(invalidHybrid as any), /hybrid.*search_documents.*query_knowledge_graph/i)

const unsupportedClaim = records.map((record, index) => index === 0 && record.recordType === 'single'
  ? { ...record, goldEvidence: [] }
  : record)
assert.throws(() => validateAcceptedCurationRecords(unsupportedClaim), /gold evidence/i)

const mismatchedEvidence = records.map((record, index) => index === 0 && record.recordType === 'single'
  ? {
    ...record,
    goldEvidence: [{
      documentFingerprint: 'f'.repeat(64),
      page: 1,
      supportingText: 'mismatched private evidence',
    }],
  }
  : record)
assert.throws(() => validateAcceptedCurationRecords(mismatchedEvidence), /gold evidence.*relevant document/i)

const evidencePacks = snapshot.documents.map((document, index) => ({
  evidencePackId: `ep-${String(index + 1).padStart(4, '0')}`,
  documentFingerprint: document.fingerprint,
  page: 1,
  chunkIds: [index + 1],
  supportingText: 'private evidence',
  entities: [{ entityId: 'entity-1', name: '测试实体', type: 'Mineral' as const }],
  kgPaths: [],
  candidateCategories: ['document_fact' as const],
  spatialEligible: false,
  privacyReviewed: true,
}))
assert.doesNotThrow(() => validateAcceptedEvidenceReferences(records, evidencePacks))
const invalidPage = records.map((record, index) => index === 0 && record.recordType === 'single'
  ? { ...record, goldEvidence: [{ ...record.goldEvidence[0]!, page: 99 }] }
  : record)
assert.throws(() => validateAcceptedEvidenceReferences(invalidPage, evidencePacks), /page 99/i)

const suite = buildFrozenPrivateSuite({
  label: 'private-holdout-v1',
  frozenAt: '2026-08-12T00:00:00.000Z',
  records,
  snapshot,
})
assert.doesNotThrow(() => assertFrozenSuitePrivacy(suite))
const leaked = structuredClone(suite) as any
leaked.singleTurnCases[0].supportingText = 'private evidence'
assert.throws(() => assertFrozenSuitePrivacy(leaked), /forbidden field.*supportingText/i)

assert.deepEqual(parseCurationCommand([
  'export', '--db', 'private.db', '--output', 'private-output', '--allow-missing-neo4j',
]), {
  command: 'export',
  dbPath: 'private.db',
  outputDirectory: 'private-output',
  allowMissingNeo4j: true,
})
assert.deepEqual(parseCurationCommand([
  'prompts', '--evidence', 'evidence.jsonl', '--output', 'prompts.jsonl',
]), {
  command: 'prompts',
  evidencePath: 'evidence.jsonl',
  outputPath: 'prompts.jsonl',
})
assert.deepEqual(parseCurationCommand([
  'validate', '--candidates', 'candidates.jsonl', '--snapshot', 'snapshot.json', '--evidence', 'evidence.jsonl',
]), {
  command: 'validate',
  candidatePath: 'candidates.jsonl',
  snapshotPath: 'snapshot.json',
  evidencePath: 'evidence.jsonl',
})
assert.deepEqual(parseCurationCommand([
  'review-export', '--candidates', 'candidates.jsonl', '--evidence', 'evidence.jsonl', '--output', 'review.csv',
]), {
  command: 'review-export', candidatePath: 'candidates.jsonl', evidencePath: 'evidence.jsonl', outputPath: 'review.csv',
})
assert.deepEqual(parseCurationCommand([
  'review-import', '--csv', 'review.csv', '--output', 'reviewed.jsonl',
]), {
  command: 'review-import', csvPath: 'review.csv', outputPath: 'reviewed.jsonl',
})
assert.throws(() => parseCurationCommand(['freeze', '--snapshot', 'snapshot.json']), /--candidates/i)
assert.equal(
  resolveCurationPath('ml-service/output/private.db', 'D:\\repo\\backend', 'D:\\repo'),
  'D:\\repo\\ml-service\\output\\private.db',
)
assert.doesNotThrow(() => assertPrivateEvaluationOutputPath(
  'D:\\repo\\backend\\evaluation\\private\\suite.json',
  'D:\\repo\\backend',
))
assert.throws(() => assertPrivateEvaluationOutputPath(
  'D:\\repo\\backend\\evaluation\\public\\suite.json',
  'D:\\repo\\backend',
), /backend\/evaluation\/private/i)
assert.equal(
  resolveCurationPath('evaluation/private/suite.json', 'D:\\repo\\backend', 'D:\\repo'),
  'D:\\repo\\backend\\evaluation\\private\\suite.json',
)

console.log('[PASS] private curation review gates, privacy scan and CLI contract')
