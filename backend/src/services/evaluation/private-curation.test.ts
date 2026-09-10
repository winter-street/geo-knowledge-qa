import assert from 'node:assert/strict'
import {
  buildEvidencePacks,
  buildFrozenPrivateSuite,
  createPrivateSnapshot,
  evidenceTextQuality,
  privateCandidateRecordSchema,
  validatePrivateSnapshot,
  validateFrozenSuiteReferences,
} from './private-curation.js'

assert.equal(evidenceTextQuality('致谢：感谢导师、同学和家人在研究期间给予的支持与帮助，本页不包含可用于地质问答的事实。').accepted, false)
assert.equal(evidenceTextQuality('参考文献：[1] 某某作者，某某地质研究，某某出版社，2024 年。该条目仅用于引用，不是事实证据。').accepted, false)
assert.equal(evidenceTextQuality('该段解释了测试矿体与围岩之间的接触关系，并给出了可供人工复核的完整限定条件。此处内容仅用于自动测试。').accepted, true)
assert.equal(evidenceTextQuality('造岩矿物主要有斜长石钾长石石英副矿物常与暗色矿物共生该段来自断裂的文字行并且没有形成完整句子').accepted, false)

const documents = [
  { id: 1, title: 'private-a', docType: 'report', totalPages: 2 },
  { id: 2, title: 'private-a-copy', docType: 'report', totalPages: 2 },
  { id: 3, title: 'private-b', docType: 'thesis', totalPages: 1 },
]
const chunks = [
  { id: 11, docId: 1, page: 1, chunkIndex: 0, text: '演示矿床甲赋存于演示辉长岩中，并受演示北向断裂控制。该段文字包含完整主语、关系和宾语，可作为独立证据。' },
  { id: 12, docId: 1, page: 2, chunkIndex: 0, text: '致谢 感谢导师和同学在研究期间给予的帮助。' },
  { id: 21, docId: 2, page: 1, chunkIndex: 0, text: '  演示矿床甲赋存于演示辉长岩中，并受演示北向断裂控制。该段文字包含完整主语、关系和宾语，可作为独立证据。  ' },
  { id: 22, docId: 2, page: 2, chunkIndex: 0, text: '致谢  感谢导师和同学在研究期间给予的帮助。' },
  { id: 31, docId: 3, page: 1, chunkIndex: 0, text: '演示矿床乙形成于演示年代乙，矿体位于演示南部区域。该证据只用于测试，不对应任何真实地点或调查结论。' },
]

const snapshot = createPrivateSnapshot({
  sqliteSha256: 'a'.repeat(64),
  documents,
  chunks,
  graph: { available: true, nodeCount: 4, relationshipCount: 2, entityIds: ['entity-1', 'entity-2'] },
  frozenAt: '2026-08-12T00:00:00.000Z',
})
assert.equal(snapshot.documentCount, 3)
assert.equal(snapshot.uniqueDocumentCount, 2)
assert.equal(snapshot.duplicateDocumentGroups.length, 1)
assert.equal(snapshot.chunkCount, 5)
assert.doesNotThrow(() => validatePrivateSnapshot(snapshot))
assert.throws(
  () => validatePrivateSnapshot({ ...snapshot, chunkCount: snapshot.chunkCount + 1 }),
  /snapshot hash mismatch/i,
)

const packs = buildEvidencePacks({
  documents,
  chunks,
  graphEvidenceByDocumentId: new Map([[1, {
    entities: [
      { entityId: 'entity-1', name: '演示矿床甲', type: 'Mineral' },
      { entityId: 'entity-2', name: '演示北向断裂', type: 'Structure' },
    ],
    kgPaths: [{ fromId: 'entity-1', relation: 'CONTROLLED_BY', toId: 'entity-2' }],
    spatialEligible: false,
  }]]),
})
assert.equal(packs.length, 2, 'duplicate documents and low-quality acknowledgements are excluded')
assert.equal(packs[0]?.documentFingerprint, snapshot.documents[0]?.fingerprint)
assert.deepEqual(packs[0]?.candidateCategories, ['document_fact', 'kg_relation'])
assert.equal(packs.every((pack) => pack.privacyReviewed === false), true)

const unrelatedGraph = buildEvidencePacks({
  documents: [documents[2]!],
  chunks: [chunks[4]!],
  graphEvidenceByDocumentId: new Map([[3, {
    entities: [{ entityId: 'entity-1', name: '正文未出现实体', type: 'Mineral' }],
    kgPaths: [{ fromId: 'entity-1', relation: 'CONTROLLED_BY', toId: 'entity-2' }],
    spatialEligible: true,
  }]]),
})
assert.deepEqual(unrelatedGraph[0]?.entities, [])
assert.deepEqual(unrelatedGraph[0]?.kgPaths, [])
assert.deepEqual(unrelatedGraph[0]?.candidateCategories, ['document_fact'])
assert.equal(unrelatedGraph[0]?.spatialEligible, false)

const suiteSnapshot = {
  ...snapshot,
  uniqueDocumentCount: 5,
  documents: [
    snapshot.documents[0]!,
    snapshot.documents[2]!,
    ...['b', 'c', 'd'].map((value, index) => ({
      documentId: 100 + index,
      fingerprint: value.repeat(64),
      chunkCount: 1,
    })),
  ],
}

function acceptedSingle(index: number, kind: 'supported' | 'refusal') {
  const supported = kind === 'supported'
  const category = ['document_fact', 'kg_relation', 'entity_detail', 'region_comparison', 'hybrid'][index % 5]!
  return privateCandidateRecordSchema.parse({
    recordType: 'single', id: `${kind}-${index}`, kind,
    question: `${kind} private question ${index}`,
    category: supported ? category : 'refusal_missing_fact',
    difficulty: index % 10 < 3 ? 'easy' : index % 10 < 8 ? 'medium' : 'hard',
    expectedIntent: category === 'entity_detail' ? 'entity_lookup'
      : category === 'region_comparison' ? 'region_comparison' : 'geology_qa',
    expectedTools: supported ? ['search_documents'] : ['search_documents', 'query_knowledge_graph'],
    expectedOutcome: supported ? 'answered' : 'refused',
    relevantDocumentFingerprints: supported ? [suiteSnapshot.documents[(index - 1) % 5]!.fingerprint] : [],
    acceptedEntityIds: supported ? ['entity-1'] : [],
    goldClaims: supported ? [`supported claim ${index}`] : [],
    goldEvidence: supported ? [{ documentFingerprint: suiteSnapshot.documents[(index - 1) % 5]!.fingerprint, page: 1, supportingText: 'private evidence' }] : [],
    unanswerableReason: supported ? null : 'No supporting document or graph relation in the frozen snapshot.',
    absenceChecks: supported ? [] : ['full_text', 'knowledge_graph'],
    generatedByAi: true,
    annotationStatus: 'accepted',
    reviewer: 'human-reviewer',
  })
}

const singles = [
  ...Array.from({ length: 30 }, (_, index) => acceptedSingle(index + 1, 'supported')),
  ...Array.from({ length: 10 }, (_, index) => acceptedSingle(index + 1, 'refusal')),
]
const multis = Array.from({ length: 10 }, (_, groupIndex) => privateCandidateRecordSchema.parse({
  recordType: 'multi', id: `multi-${groupIndex + 1}`,
  scenario: ['pronoun_followup', 'entity_comparison', 'entity_ambiguity', 'kg_followup', 'topic_switch'][groupIndex % 5],
  annotationStatus: 'accepted', reviewer: 'human-reviewer', generatedByAi: true,
  turns: Array.from({ length: 3 }, (_, turnIndex) => ({
    id: `multi-${groupIndex + 1}-turn-${turnIndex + 1}`,
    question: `private multi question ${groupIndex + 1}-${turnIndex + 1}`,
    expectedIntent: turnIndex === 1 && groupIndex % 5 === 2 ? 'clarification' : 'entity_lookup',
    expectedTools: ['get_entity_detail'],
    relevantDocumentFingerprints: [snapshot.documents[0]!.fingerprint],
    acceptedEntityIds: ['entity-1'],
    expectedOutcome: turnIndex === 1 && groupIndex % 5 === 2 ? 'clarification_required' : 'answered',
    goldClaims: ['private supported claim'],
    goldEvidence: [{ documentFingerprint: snapshot.documents[0]!.fingerprint, page: 1, supportingText: 'private evidence' }],
  })),
}))

const suite = buildFrozenPrivateSuite({
  label: 'private-holdout-v1', frozenAt: '2026-08-12T00:00:00.000Z',
  records: [...singles, ...multis], snapshot: suiteSnapshot,
})
assert.equal(suite.singleTurnCases.length, 40)
assert.equal(suite.multiTurnCases.length, 10)
assert.doesNotThrow(() => validateFrozenSuiteReferences(suite, suiteSnapshot))

const invalid = structuredClone(suite)
invalid.singleTurnCases[0]!.relevantDocumentFingerprints = ['f'.repeat(64)]
assert.throws(() => validateFrozenSuiteReferences(invalid, suiteSnapshot), /unknown document fingerprint/i)

console.log('[PASS] private evidence curation and frozen-suite validation')
