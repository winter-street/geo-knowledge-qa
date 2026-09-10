import assert from 'node:assert/strict'
import type { Chunk, KGPath } from '../types/index.js'
import { buildEvidenceCitations, groundAnswer } from './grounding.js'

const ragResults = [{
  chunk: {
    id: 12,
    docTitle: 'Synthetic Report',
    page: 3,
    docType: 'synthetic',
    content: '花岗岩体与铜矿化关系密切，北东向断裂控制热液活动。',
  } satisfies Chunk,
  score: 0.9,
}]
const kgPaths: KGPath[] = [
  { from: '铜矿', relation: '受控于', relationType: 'CONTROLLED_BY', to: '北东向断裂' },
]

const citations = buildEvidenceCitations(ragResults, kgPaths)
assert.deepEqual(citations.map((citation) => citation.id), ['D12-P3', 'KG1'])
assert.equal(citations[0]?.docId, 12)
assert.equal(citations[1]?.kgPathIndex, 0)

const grounded = groundAnswer('铜矿受北东向断裂控制。', ragResults, kgPaths)
assert.match(grounded.answer, /\[KG1\]/)
assert.deepEqual(grounded.citations.map((citation) => citation.id), ['KG1'])

const unsupported = groundAnswer('该矿床储量超过一亿吨。', ragResults, kgPaths)
assert.match(unsupported.answer, /证据不足|无法确认/)
assert.deepEqual(unsupported.citations, [])

const invalidCitation = groundAnswer('该矿床储量超过一亿吨。[D999-P1]', ragResults, kgPaths)
assert.match(invalidCitation.answer, /证据不足|无法确认/)
assert.deepEqual(invalidCitation.citations, [])

const englishEvidence = [{
  chunk: {
    id: 21,
    docTitle: 'Synthetic Evidence',
    page: 4,
    docType: 'synthetic',
    content: 'The Demo copper deposit is controlled by the North Ridge fault.',
  } satisfies Chunk,
  score: 0.88,
}]
const supportedDocumentClaim = groundAnswer(
  'The Demo copper deposit is controlled by the North Ridge fault.',
  englishEvidence,
  [],
)
assert.equal(supportedDocumentClaim.rejectedClaims, 0)
assert.deepEqual(supportedDocumentClaim.citations.map((citation) => citation.id), ['D21-P4'])

for (const claim of [
  'The Demo copper deposit contains 100 million tonnes of reserves.',
  'The Demo copper deposit is located in South Valley.',
  'The Demo copper deposit caused the North Ridge fault.',
  'The Demo copper deposit controlled the North Ridge fault.',
  'The Demo copper deposit is large.',
  'The Demo copper deposit has economic value.',
]) {
  const rejected = groundAnswer(claim, englishEvidence, [])
  assert.equal(rejected.rejectedClaims, 1)
  assert.deepEqual(rejected.citations, [], `unsupported claim must be rejected: ${claim}`)
}

const crossSentenceEvidence = [{
  chunk: {
    id: 22,
    docTitle: 'Synthetic Cross Sentence Evidence',
    page: 5,
    docType: 'synthetic',
    content: 'The Demo copper deposit is controlled by the North Ridge fault. The neighboring district is large.',
  } satisfies Chunk,
  score: 0.84,
}]
const crossSentenceClaim = groundAnswer(
  'The Demo copper deposit is large.',
  crossSentenceEvidence,
  [],
)
assert.equal(crossSentenceClaim.rejectedClaims, 1)
assert.deepEqual(crossSentenceClaim.citations, [])

for (const content of [
  'The Demo copper deposit is small, the neighboring district is large.',
  '示范铜矿床规模较小，邻区规模较大。',
]) {
  const commaClauseClaim = groundAnswer(
    content.startsWith('The') ? 'The Demo copper deposit is large.' : '示范铜矿床规模较大。',
    [{
      chunk: {
        id: 24,
        docTitle: 'Synthetic Comma Clause Evidence',
        page: 7,
        docType: 'synthetic',
        content,
      } satisfies Chunk,
      score: 0.8,
    }],
    [],
  )
  assert.equal(commaClauseClaim.rejectedClaims, 1, `predicate must not cross comma clauses: ${content}`)
  assert.deepEqual(commaClauseClaim.citations, [])
}

for (const content of [
  'The Demo copper deposit lacks economic value.',
  'Economic value is absent from the Demo copper deposit.',
  'The Demo copper deposit has insufficient economic value.',
]) {
  const contradictedValueClaim = groundAnswer(
    'The Demo copper deposit has economic value.',
    [{
      chunk: {
        id: 25,
        docTitle: 'Synthetic Predicate Polarity Evidence',
        page: 8,
        docType: 'synthetic',
        content,
      } satisfies Chunk,
      score: 0.79,
    }],
    [],
  )
  assert.equal(contradictedValueClaim.rejectedClaims, 1, `contradicted predicate must be rejected: ${content}`)
  assert.deepEqual(contradictedValueClaim.citations, [])
}

const comparativeClaim = groundAnswer(
  'The Demo copper deposit is large.',
  [{
    chunk: {
      id: 26,
      docTitle: 'Synthetic Comparative Evidence',
      page: 9,
      docType: 'synthetic',
      content: 'The Demo copper deposit is smaller than the large neighboring district.',
    } satisfies Chunk,
    score: 0.78,
  }],
  [],
)
assert.equal(comparativeClaim.rejectedClaims, 1)
assert.deepEqual(comparativeClaim.citations, [])

const negatedEvidence = [{
  chunk: {
    id: 23,
    docTitle: 'Synthetic Negated Evidence',
    page: 6,
    docType: 'synthetic',
    content: 'The Demo copper deposit is not large.',
  } satisfies Chunk,
  score: 0.82,
}]
const contradictedClaim = groundAnswer('The Demo copper deposit is large.', negatedEvidence, [])
assert.equal(contradictedClaim.rejectedClaims, 1)
assert.deepEqual(contradictedClaim.citations, [])

const supportedNegation = groundAnswer('The Demo copper deposit is not large.', negatedEvidence, [])
assert.equal(supportedNegation.rejectedClaims, 0)
assert.deepEqual(supportedNegation.citations.map((citation) => citation.id), ['D23-P6'])

const syntheticKgEvidence: KGPath[] = [{
  from: 'Synthetic Aurora Deposit 1',
  relation: 'controlled by',
  relationType: 'CONTROLLED_BY',
  to: 'Synthetic Meridian Fault 1',
  synthetic: true,
  isMock: true,
}]
const syntheticKgClaim = groundAnswer(
  'Synthetic Aurora Deposit 1 is controlled by Synthetic Meridian Fault 1.',
  [],
  syntheticKgEvidence,
)
assert.equal(syntheticKgClaim.rejectedClaims, 0)
assert.deepEqual(syntheticKgClaim.citations.map((citation) => citation.id), ['KG1'])

const legacyMockKgClaim = groundAnswer(
  'Demo Deposit is controlled by Demo Fault.',
  [],
  [{
    from: 'Demo Deposit',
    relation: 'controlled by',
    relationType: 'CONTROLLED_BY',
    to: 'Demo Fault',
    isMock: true,
  }],
)
assert.equal(legacyMockKgClaim.rejectedClaims, 1)
assert.deepEqual(legacyMockKgClaim.citations, [])

const directionalKgCases: Array<{
  path: KGPath
  supported: string[]
  rejected: string[]
}> = [
  {
    path: { from: 'Demo Deposit', relation: 'controlled by', relationType: 'CONTROLLED_BY', to: 'Demo Fault' },
    supported: ['Demo Deposit is controlled by Demo Fault.', 'Demo Fault controls Demo Deposit.'],
    rejected: ['Demo Deposit controls Demo Fault.', 'Demo Fault is controlled by Demo Deposit.'],
  },
  {
    path: { from: 'Demo Deposit', relation: 'hosted in', relationType: 'HOSTED_IN', to: 'Demo Granite' },
    supported: ['Demo Deposit is hosted in Demo Granite.', 'Demo Granite hosts Demo Deposit.'],
    rejected: ['Demo Deposit hosts Demo Granite.', 'Demo Granite is hosted in Demo Deposit.'],
  },
  {
    path: { from: 'Demo Deposit', relation: 'formed in', relationType: 'FORMED_IN', to: 'Demo Epoch' },
    supported: ['Demo Deposit formed in Demo Epoch.'],
    rejected: ['Demo Epoch formed in Demo Deposit.'],
  },
  {
    path: { from: 'Demo Deposit', relation: 'lies in', relationType: 'LIES_IN', to: 'Demo Region' },
    supported: ['Demo Deposit lies in Demo Region.'],
    rejected: ['Demo Region lies in Demo Deposit.'],
  },
  {
    path: { from: 'Demo Fault', relation: 'cuts', relationType: 'CUTS', to: 'Demo Granite' },
    supported: ['Demo Fault cuts Demo Granite.', 'Demo Granite is cut by Demo Fault.'],
    rejected: ['Demo Granite cuts Demo Fault.', 'Demo Fault is cut by Demo Granite.'],
  },
]

for (const { path, supported, rejected } of directionalKgCases) {
  for (const claim of supported) {
    const result = groundAnswer(claim, [], [path])
    assert.equal(result.rejectedClaims, 0, `stored KG direction must be supported: ${claim}`)
    assert.deepEqual(result.citations.map((citation) => citation.id), ['KG1'])
  }
  for (const claim of rejected) {
    const result = groundAnswer(claim, [], [path])
    assert.equal(result.rejectedClaims, 1, `inverse KG direction must be rejected: ${claim}`)
    assert.deepEqual(result.citations, [])
  }
}

console.log('[PASS] claim citations and unsupported-claim refusal')
