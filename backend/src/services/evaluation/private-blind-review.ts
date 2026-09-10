import { createHash } from 'node:crypto'
import type { PrivateQualityObservation, PrivateQualityRun } from './private-quality.js'

const HEADERS = [
  'pair_id', 'case_id_hash', 'mode', 'question', 'answer_a', 'answer_b',
  'citations_a', 'citations_b', 'expected_outcome', 'reviewer_preference',
  'factual_support', 'citation_support', 'refusal_correct', 'notes',
]

function csv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function observationKey(observation: PrivateQualityObservation): string {
  return [
    observation.conversationGroupId ?? 'single',
    observation.caseId,
    observation.mode,
    observation.turnIndex ?? 0,
  ].join(':')
}

function shortHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16)
}

export function renderBlindReviewCsv(baseline: PrivateQualityRun, candidate: PrivateQualityRun): string {
  if (baseline.suiteHash !== candidate.suiteHash) throw new Error('Blind review runs must use the same frozen suite.')
  const candidateByKey = new Map(candidate.observations.map((item) => [observationKey(item), item]))
  const rows = baseline.observations.flatMap((baselineItem) => {
    const key = observationKey(baselineItem)
    const candidateItem = candidateByKey.get(key)
    if (!candidateItem) return []
    const caseHash = shortHash(`${baseline.suiteHash}:${key}`)
    const candidateFirst = Number.parseInt(caseHash.slice(-1), 16) % 2 === 0
    const answerA = candidateFirst ? candidateItem : baselineItem
    const answerB = candidateFirst ? baselineItem : candidateItem
    return [[
      `pair-${caseHash}`,
      caseHash,
      baselineItem.mode,
      baselineItem.question,
      answerA.answer,
      answerB.answer,
      answerA.citationIds.join(' '),
      answerB.citationIds.join(' '),
      '', '', '', '', '', '',
    ].map((value) => csv(String(value))).join(',')]
  })
  return `${HEADERS.join(',')}\n${rows.join('\n')}${rows.length > 0 ? '\n' : ''}`
}
