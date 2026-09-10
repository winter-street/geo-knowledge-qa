import type { AgentCitation, Chunk, KGPath } from '../types/index.js'
import { tokenize } from './tokenizer.js'

type RagEvidence = { chunk: Chunk; score: number }

interface EvidenceRecord {
  citation: AgentCitation
  text: string
  kind: 'document' | 'kg'
  path?: KGPath
}

const CITATION_PATTERN = /\[(D\d+-P\d+|KG\d+)\]/g
const REFUSAL_PATTERN = /证据不足|无法确认|不能确定|未检索到|暂无足够|信息不足/
const CLAIM_SIGNAL_GROUPS = [
  /control(?:led|s|ling)?|受控|控制|控矿/iu,
  /caus(?:e|ed|es|ing)|lead(?:s)?\s+to|导致|引起|造成/iu,
  /locat(?:e|ed|es|ion)|位于|分布于|坐落|附近/iu,
  /host(?:ed|s|ing)|赋存|产于|容矿|寄主/iu,
  /form(?:ed|s|ing|ation)|形成|成因|成矿/iu,
  /associat(?:e|ed|es|ion)|related|关系密切|相关|伴生|共生/iu,
  /reserve|grade|tonne|tons?|depth|thickness|width|length|储量|品位|吨|深度|厚度|宽度|长度|规模/iu,
] as const

const DIRECTIONAL_VOICE_CHECKS = [
  { signal: CLAIM_SIGNAL_GROUPS[0], passive: /controlled\s+by|受控于|受.{0,24}控制/iu },
  { signal: CLAIM_SIGNAL_GROUPS[1], passive: /caused\s+by|由.{0,24}(?:导致|引起|造成)/iu },
] as const

const DOCUMENT_FUNCTION_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by', 'for',
  'from', 'has', 'have', 'had', 'in', 'is', 'it', 'of', 'on', 'or', 'that',
  'the', 'this', 'to', 'was', 'were', 'with',
])

const NEGATION_PATTERN = /\b(?:not|no|never|without|neither|nor)\b|(?:不|未|无|非|没有|并非|不是)/iu

const KG_RELATION_SIGNALS: Record<string, RegExp> = {
  CONTROLLED_BY: CLAIM_SIGNAL_GROUPS[0],
  LIES_IN: CLAIM_SIGNAL_GROUPS[2],
  HOSTED_IN: CLAIM_SIGNAL_GROUPS[3],
  FORMED_IN: CLAIM_SIGNAL_GROUPS[4],
  ASSOCIATED_WITH: CLAIM_SIGNAL_GROUPS[5],
  BELONGS_TO: /belong(?:s|ed)?|属于/iu,
  CUTS: /cut(?:s|ting)?|穿切|切割/iu,
  REFERENCES: /reference(?:s|d)?|引用|提及/iu,
}

export function buildEvidenceCitations(
  ragResults: RagEvidence[],
  kgPaths: KGPath[],
): AgentCitation[] {
  const documents = ragResults.map((result) => ({
    id: `D${result.chunk.id}-P${result.chunk.page}`,
    label: `[D${result.chunk.id}-P${result.chunk.page}]`,
    kind: 'document' as const,
    docId: result.chunk.id,
    page: result.chunk.page,
  }))
  const graph = kgPaths
    .filter((path) => !path.isMock || path.synthetic)
    .map((path, index) => ({
      id: `KG${index + 1}`,
      label: `[KG${index + 1}]`,
      kind: 'kg' as const,
      kgPathIndex: kgPaths.indexOf(path),
    }))
  return [...documents, ...graph]
}

function evidenceRecords(ragResults: RagEvidence[], kgPaths: KGPath[]): EvidenceRecord[] {
  const citationById = new Map(buildEvidenceCitations(ragResults, kgPaths).map((item) => [item.id, item]))
  const documents = ragResults.map((result) => {
    const id = `D${result.chunk.id}-P${result.chunk.page}`
    return { citation: citationById.get(id)!, text: result.chunk.content, kind: 'document' as const }
  })
  let graphIndex = 0
  const graph = kgPaths.flatMap((path) => {
    if (path.isMock && !path.synthetic) return []
    graphIndex += 1
    const id = `KG${graphIndex}`
    return [{
      citation: citationById.get(id)!,
      text: `${path.from} ${path.relation} ${path.to}`,
      kind: 'kg' as const,
      path,
    }]
  })
  return [...documents, ...graph]
}

function lexicalSupport(statement: string, evidence: EvidenceRecord): number {
  const plain = statement.replace(CITATION_PATTERN, '').replace(/^[#>*\-\d.\s]+/, '').trim()
  if (!plain) return 0
  if (evidence.kind === 'kg' && evidence.path) {
    return supportsKgDirection(plain, evidence.path) ? 1 : 0
  }
  return Math.max(
    0,
    ...splitEvidenceClauses(evidence.text).map((clause) => documentClauseSupport(plain, clause)),
  )
}

function supportsKgDirection(statement: string, path: KGPath): boolean {
  const plain = statement.toLocaleLowerCase('en-US')
  const from = path.from.toLocaleLowerCase('en-US')
  const to = path.to.toLocaleLowerCase('en-US')
  const fromIndex = plain.indexOf(from)
  const toIndex = plain.indexOf(to)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return false

  const fromBeforeTo = fromIndex < toIndex
  const relationType = (path.relationType ?? path.relation).toLocaleUpperCase('en-US')
  const hasKnownSignal = Boolean(KG_RELATION_SIGNALS[relationType]?.test(statement))
  if (!hasKnownSignal && !plain.includes(path.relation.toLocaleLowerCase('en-US'))) return false

  switch (relationType) {
    case 'CONTROLLED_BY':
      return fromBeforeTo
        ? /controlled\s+by|受控于|受.{0,24}控制/iu.test(statement)
        : /\bcontrols?\b|控制/iu.test(statement)
    case 'HOSTED_IN':
      return fromBeforeTo
        ? /hosted\s+in|赋存于|产于|寄主于/iu.test(statement)
        : /\bhosts?\b|容矿|赋存有/iu.test(statement)
    case 'FORMED_IN':
      return fromBeforeTo && /formed?\s+in|形成于|成矿于/iu.test(statement)
    case 'LIES_IN':
      return fromBeforeTo && /lies?\s+in|located\s+in|位于|分布于|坐落于/iu.test(statement)
    case 'CUTS':
      return fromBeforeTo
        ? !/cut\s+by|被.{0,24}(?:切割|穿切)/iu.test(statement)
          && /\bcuts?\b|切割|穿切/iu.test(statement)
        : /cut\s+by|被.{0,24}(?:切割|穿切)/iu.test(statement)
    case 'BELONGS_TO':
      return fromBeforeTo && /belongs?\s+to|属于/iu.test(statement)
    case 'REFERENCES':
      return fromBeforeTo && /references?|cites?|引用|提及/iu.test(statement)
    case 'ASSOCIATED_WITH':
      return /associated\s+with|related\s+to|相关|关联|伴生|共生/iu.test(statement)
    default: {
      const relationIndex = plain.indexOf(path.relation.toLocaleLowerCase('en-US'))
      return relationIndex > fromIndex && relationIndex < toIndex
    }
  }
}

function documentClauseSupport(statement: string, clause: string): number {
  const numberClaims = statement.match(/\d+(?:\.\d+)?%?/gu) ?? []
  if (numberClaims.some((value) => !clause.includes(value))) return 0
  if (CLAIM_SIGNAL_GROUPS.some((pattern) => pattern.test(statement) && !pattern.test(clause))) return 0
  if (DIRECTIONAL_VOICE_CHECKS.some(({ signal, passive }) =>
    signal.test(statement)
      && signal.test(clause)
      && passive.test(statement) !== passive.test(clause),
  )) return 0
  if (NEGATION_PATTERN.test(statement) !== NEGATION_PATTERN.test(clause)) return 0
  const statementTokens = normalizeDocumentTokens(statement)
  const evidenceTokens = normalizeDocumentTokens(clause)
  if (statementTokens.length === 0 || evidenceTokens.length === 0) return 0
  return containsContiguousSequence(evidenceTokens, statementTokens) ? 1 : 0
}

function containsContiguousSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length > haystack.length) return false
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) return true
  }
  return false
}

function splitEvidenceClauses(text: string): string[] {
  return text
    .split(/(?<=[.!?。！？；;,，])|\n+|\b(?:and|but|while|whereas)\b|(?:以及|而且|但是|同时)/iu)
    .map((clause) => clause.trim())
    .filter(Boolean)
}

function normalizeDocumentTokens(text: string): string[] {
  return tokenize(text)
    .map((token) => token.toLocaleLowerCase('en-US'))
    .filter((token) => token.length >= 2 && !DOCUMENT_FUNCTION_WORDS.has(token))
}

export function groundAnswer(
  answer: string,
  ragResults: RagEvidence[],
  kgPaths: KGPath[],
): { answer: string; citations: AgentCitation[]; rejectedClaims: number } {
  const records = evidenceRecords(ragResults, kgPaths)
  if (records.length === 0) {
    if (REFUSAL_PATTERN.test(answer)) return { answer, citations: [], rejectedClaims: 0 }
    return { answer: '当前证据不足，无法确认该问题中的事实性结论。', citations: [], rejectedClaims: 1 }
  }

  const validById = new Map(records.map((record) => [record.citation.id, record]))
  const statements = answer.split(/(?<=[。！？!?])|\n+/).map((item) => item.trim()).filter(Boolean)
  const accepted: string[] = []
  const used = new Set<string>()
  let rejectedClaims = 0

  for (const statement of statements) {
    if (REFUSAL_PATTERN.test(statement)) {
      accepted.push(statement)
      continue
    }
    const explicitIds = [...statement.matchAll(CITATION_PATTERN)].map((match) => match[1])
    const candidateRecords = explicitIds.length > 0
      ? explicitIds.map((id) => validById.get(id)).filter((item): item is EvidenceRecord => Boolean(item))
      : records
    const ranked = candidateRecords
      .map((record) => ({ record, score: lexicalSupport(statement, record) }))
      .sort((left, right) =>
        right.score - left.score
          || Number(right.record.kind === 'kg') - Number(left.record.kind === 'kg')
          || left.record.citation.id.localeCompare(right.record.citation.id),
      )
    const best = ranked[0]
    if (!best || best.score < 0.45) {
      rejectedClaims += 1
      continue
    }
    used.add(best.record.citation.id)
    accepted.push(explicitIds.includes(best.record.citation.id)
      ? statement
      : `${statement} ${best.record.citation.label}`)
  }

  if (accepted.length === 0) {
    return {
      answer: '当前证据不足，无法确认该问题中的事实性结论。',
      citations: [],
      rejectedClaims: Math.max(1, rejectedClaims),
    }
  }
  return {
    answer: accepted.join('\n'),
    citations: records.map((record) => record.citation).filter((citation) => used.has(citation.id)),
    rejectedClaims,
  }
}
