import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  buildCandidatePromptBatch,
  exportPrivateCurationAssets,
  loadPrivateCorpus,
  renderReviewedCandidatePrompts,
  renderCandidateGenerationPrompt,
  renderCandidateReviewCsv,
  parseCandidateReviewCsv,
} from './private-curation-io.js'
import type { PrivateEvidencePack } from './private-curation.js'

function testFingerprint(index: number): string {
  return index.toString(16).padStart(64, '0')
}

function testPack(index: number, privacyReviewed: boolean, documentIndex = index % 41): PrivateEvidencePack {
  const firstEntity = `entity-${index}-a`
  const secondEntity = `entity-${index}-b`
  return {
    evidencePackId: `ep-${String(index + 1).padStart(4, '0')}`,
    documentFingerprint: testFingerprint(documentIndex + 1),
    page: (index % 20) + 1,
    chunkIds: [index + 1],
    supportingText: `Synthetic private evidence sentence ${index}; complete enough for deterministic prompt tests.`,
    entities: [
      { entityId: firstEntity, name: `Synthetic entity ${index} A`, type: 'Mineral' },
      { entityId: secondEntity, name: `Synthetic entity ${index} B`, type: 'Mineral' },
    ],
    kgPaths: [{ fromId: firstEntity, relation: 'ASSOCIATED_WITH', toId: secondEntity }],
    candidateCategories: ['document_fact', 'kg_relation'],
    spatialEligible: false,
    privacyReviewed,
  }
}

const directory = mkdtempSync(path.join(tmpdir(), 'private-curation-'))
try {
  const dbPath = path.join(directory, 'private.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY, title TEXT, doc_type TEXT, total_pages INTEGER);
    CREATE TABLE chunks (id INTEGER PRIMARY KEY, doc_id INTEGER, page INTEGER, chunk_index INTEGER, text TEXT);
    INSERT INTO documents VALUES (1, 'SECRET_TITLE', 'report', 1);
    INSERT INTO chunks VALUES (10, 1, 1, 0,
      '演示矿床甲赋存于演示辉长岩中，并受到演示断裂控制。该文本长度足够且语义完整，仅用于私有整理工具的自动测试。');
  `)
  db.close()

  const corpus = loadPrivateCorpus(dbPath)
  assert.equal(corpus.documents.length, 1)
  assert.equal(corpus.chunks[0]?.id, 10)

  const output = path.join(directory, 'output')
  const result = await exportPrivateCurationAssets({
    dbPath,
    outputDirectory: output,
    frozenAt: '2026-08-12T00:00:00.000Z',
    graphProvider: async () => ({
      snapshot: { available: true, nodeCount: 2, relationshipCount: 1, entityIds: ['entity-1', 'entity-2'] },
      evidenceByDocumentId: new Map([[1, {
        entities: [{ entityId: 'entity-1', name: '演示矿床甲', type: 'Mineral' as const }],
        kgPaths: [{ fromId: 'entity-1', relation: 'CONTROLLED_BY', toId: 'entity-2' }],
        spatialEligible: false,
      }]]),
    }),
  })
  assert.equal(result.snapshot.documentCount, 1)
  assert.equal(result.evidencePacks.length, 1)
  const manifest = readFileSync(path.join(output, 'snapshot.private.json'), 'utf8')
  const jsonl = readFileSync(path.join(output, 'evidence-packs.private.jsonl'), 'utf8')
  assert.equal(existsSync(path.join(output, 'candidate-prompts.private.jsonl')), false)
  const candidatePoolPath = path.join(output, 'candidate-pool.private.jsonl')
  assert.equal(existsSync(candidatePoolPath), true, 'export initializes a private candidate pool')
  writeFileSync(candidatePoolPath, 'human annotation must survive rerun\n', 'utf8')
  await exportPrivateCurationAssets({ dbPath, outputDirectory: output, frozenAt: '2026-08-12T00:00:00.000Z' })
  assert.equal(readFileSync(candidatePoolPath, 'utf8'), 'human annotation must survive rerun\n')
  assert.equal(manifest.includes('SECRET_TITLE'), false, 'snapshot must not persist document titles')
  assert.equal(jsonl.includes(dbPath), false, 'evidence packs must not persist private paths')

  const prompt = renderCandidateGenerationPrompt(result.evidencePacks[0]!)
  assert.match(prompt, /不得使用证据之外的知识/)
  assert.match(prompt, /human_review/)
  assert.match(prompt, /不得.*标记为 accepted/)
  assert.equal(prompt.includes('SECRET_TITLE'), false)
  assert.deepEqual(renderReviewedCandidatePrompts(result.evidencePacks), [])
  const reviewedPrompts = renderReviewedCandidatePrompts([
    { ...result.evidencePacks[0]!, privacyReviewed: true },
  ])
  assert.equal(reviewedPrompts.length, 1)

  const reviewedPacks = Array.from({ length: 349 }, (_, index) => testPack(index, true))
  const rejectedPacks = Array.from({ length: 175 }, (_, index) => testPack(index + 1000, false))
  const mixedPacks = [...reviewedPacks, ...rejectedPacks]
  const beforeGeneration = JSON.stringify(mixedPacks)
  const batch = buildCandidatePromptBatch(mixedPacks)
  assert.equal(batch.prompts.length, 85)
  assert.deepEqual(batch.stats, {
    evidencePackCount: 524,
    reviewedEvidencePackCount: 349,
    skippedEvidencePackCount: 175,
    coveredDocumentCount: 41,
    promptCount: 85,
    supportedCounts: {
      document_fact: 11, kg_relation: 11, entity_detail: 11, region_comparison: 11, hybrid: 11,
    },
    refusalCount: 15,
    multiCount: 15,
    multiScenarioCounts: {
      pronoun_followup: 3, entity_comparison: 3, entity_ambiguity: 3, kg_followup: 3, topic_switch: 3,
    },
  })
  assert.equal(JSON.stringify(mixedPacks), beforeGeneration, 'prompt generation must not mutate evidence packs')

  const prompts = batch.prompts
  const reviewedIds = new Set(reviewedPacks.map((pack) => pack.evidencePackId))
  const rejectedIds = new Set(rejectedPacks.map((pack) => pack.evidencePackId))
  assert.equal(prompts.every((item) => item.evidencePackIds.every((id) => reviewedIds.has(id))), true)
  assert.equal(prompts.some((item) => item.evidencePackIds.some((id) => rejectedIds.has(id))), false)
  const supported = prompts.filter((item) => item.promptType === 'supported')
  for (const category of ['document_fact', 'kg_relation', 'entity_detail', 'region_comparison', 'hybrid'] as const) {
    assert.equal(supported.filter((item) => item.supportedCategory === category).length, 11)
  }
  const packById = new Map(reviewedPacks.map((pack) => [pack.evidencePackId, pack]))
  for (const item of supported.filter((prompt) => prompt.supportedCategory === 'region_comparison')) {
    const selected = item.evidencePackIds.map((id) => packById.get(id)!)
    assert.equal(selected.length, 2)
    assert.notEqual(selected[0]!.documentFingerprint, selected[1]!.documentFingerprint)
  }
  for (const item of supported.filter((prompt) => ['kg_relation', 'hybrid'].includes(prompt.supportedCategory!))) {
    assert.equal(item.evidencePackIds.every((id) => packById.get(id)!.kgPaths.length > 0), true)
  }
  for (const item of supported.filter((prompt) => prompt.supportedCategory === 'entity_detail')) {
    assert.equal(item.evidencePackIds.every((id) => packById.get(id)!.entities.length > 0), true)
  }
  const refusalPrompts = prompts.filter((item) => item.promptType === 'refusal')
  assert.equal(refusalPrompts.length, 15)
  assert.equal(refusalPrompts.every((item) => /annotationStatus.*human_review/s.test(item.prompt)), true)
  assert.equal(refusalPrompts.every((item) => /不能确认.*不存在/s.test(item.prompt)), true)
  const multiPrompts = prompts.filter((item) => item.promptType === 'multi')
  for (const scenario of ['pronoun_followup', 'entity_comparison', 'entity_ambiguity', 'kg_followup', 'topic_switch'] as const) {
    assert.equal(multiPrompts.filter((item) => item.scenario === scenario).length, 3)
  }
  assert.equal(multiPrompts.every((item) => /三轮/.test(item.prompt)), true)
  assert.equal(
    new Set(supported.filter((item) => item.supportedCategory === 'document_fact').slice(0, 5)
      .map((item) => reviewedPacks.find((pack) => pack.evidencePackId === item.evidencePackIds[0])!.documentFingerprint)).size,
    5,
    'supported prompts use round-robin document diversity',
  )
  const insufficientKg = Array.from({ length: 80 }, (_, index) => ({ ...testPack(index + 2000, true), kgPaths: [] }))
  assert.throws(
    () => buildCandidatePromptBatch(insufficientKg),
    /kg_relation.*requires 11.*available packs 0.*available documents 0/i,
  )
  const oneDocument = Array.from({ length: 80 }, (_, index) => testPack(index + 3000, true, 0))
  assert.throws(
    () => buildCandidatePromptBatch(oneDocument),
    /region_comparison.*requires 11.*available documents 1/i,
  )
  let emptyCapacityError = ''
  try {
    buildCandidatePromptBatch([])
  } catch (error) {
    emptyCapacityError = error instanceof Error ? error.message : String(error)
  }
  for (const [label, required] of [
    ['document_fact', 11], ['kg_relation', 11], ['entity_detail', 11],
    ['region_comparison', 11], ['hybrid', 11], ['refusal', 15],
    ['pronoun_followup', 3], ['entity_comparison', 3], ['entity_ambiguity', 3],
    ['kg_followup', 3], ['topic_switch', 3],
  ] as const) {
    assert.match(
      emptyCapacityError,
      new RegExp(`${label}.*requires ${required}.*available packs 0.*available documents 0`, 'i'),
      `${label} capacity failure must be reported explicitly`,
    )
  }
  const candidate = {
    recordType: 'single' as const,
    id: 'single-csv-1', kind: 'supported' as const, question: '测试问题', category: 'document_fact',
    difficulty: 'easy' as const, expectedIntent: 'geology_qa' as const,
    expectedTools: ['search_documents' as const], expectedOutcome: 'answered' as const,
    relevantDocumentFingerprints: [reviewedPacks[0]!.documentFingerprint], acceptedEntityIds: [],
    goldClaims: ['测试事实'], goldEvidence: [{ documentFingerprint: reviewedPacks[0]!.documentFingerprint, page: 1, supportingText: reviewedPacks[0]!.supportingText }],
    unanswerableReason: null, absenceChecks: [], generatedByAi: true, annotationStatus: 'candidate' as const,
  }
  const csv = renderCandidateReviewCsv([candidate], reviewedPacks)
  assert.match(csv, /^candidate_id,record_type,kind,question,category/)
  assert.match(csv, /supporting_text/)
  const parsed = parseCandidateReviewCsv(csv)
  assert.equal(parsed[0]?.id, candidate.id)
  assert.equal(parsed[0]?.annotationStatus, 'candidate')
  const acceptedCsv = csv.replace('candidate,', 'accepted,').replace(',,"{', ',human-reviewer,"{')
  assert.throws(() => parseCandidateReviewCsv(acceptedCsv), /requires a human reviewer/i)
  assert.throws(() => parseCandidateReviewCsv(csv.replace('single-csv-1,', 'wrong-id,')), /ID mismatch/i)
  assert.throws(() => parseCandidateReviewCsv(csv + csv.split('\n').slice(1).join('\n')), /duplicate candidate ID/i)
  const refusal = {
    ...candidate, id: 'refusal-csv-1', kind: 'refusal' as const, category: 'refusal_relation_missing',
    expectedOutcome: 'refused' as const, relevantDocumentFingerprints: [], goldClaims: [], goldEvidence: [],
    unanswerableReason: '冻结知识库没有相应关系。', absenceChecks: ['full_text' as const], generatedByAi: true,
    annotationStatus: 'accepted' as const, reviewer: 'human-reviewer',
  }
  assert.throws(() => parseCandidateReviewCsv(renderCandidateReviewCsv([refusal], reviewedPacks)), /knowledge_graph absence check/i)
} finally {
  rmSync(directory, { recursive: true, force: true })
}

console.log('[PASS] private curation SQLite export and prompt contract')
