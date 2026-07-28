import type {
  EntityLinkCandidate,
  EntityLinkResult,
  EntityMatchMethod,
  LinkedEntity,
} from '../../types/index.js'

interface ScoredEntity extends LinkedEntity {
  sourceOrder: number
  ambiguityKey: string
}

const CONTEXT_REFERENCE_PATTERN = /它|该|此|这个|那个|上述|刚才|前者|后者/

function makeLinkedEntity(
  candidate: EntityLinkCandidate,
  matchedBy: EntityMatchMethod,
  confidence: number,
  disambiguation: string,
  sourceOrder: number,
  ambiguityKey: string,
): ScoredEntity {
  return { ...candidate, matchedBy, confidence, disambiguation, sourceOrder, ambiguityKey }
}

function compareEntities(left: ScoredEntity, right: ScoredEntity): number {
  if (left.confidence !== right.confidence) return right.confidence - left.confidence
  if (left.id < right.id) return -1
  if (left.id > right.id) return 1
  return left.sourceOrder - right.sourceOrder
}

export function linkEntities(
  question: string,
  candidates: EntityLinkCandidate[],
  activeEntities: LinkedEntity[],
): EntityLinkResult {
  const directMatches = candidates.flatMap((candidate, index) => {
    if (question.includes(candidate.name)) {
      return [makeLinkedEntity(candidate, 'name', 1, 'Exact entity name match', index, `name:${candidate.name}`)]
    }
    const alias = candidate.aliases?.find((value) => value && question.includes(value))
    return alias
      ? [makeLinkedEntity(candidate, 'alias', 0.95, `Alias match: ${alias}`, index, `alias:${alias}`)]
      : []
  })

  const contextMatches = directMatches.length === 0 && CONTEXT_REFERENCE_PATTERN.test(question)
    ? activeEntities.map((entity, index) => ({
      ...entity,
      matchedBy: 'context' as const,
      confidence: 0.9,
      disambiguation: 'Resolved from active conversation context',
      sourceOrder: index,
      ambiguityKey: 'context',
    }))
    : []

  const unique = new Map<string, ScoredEntity>()
  for (const entity of [...directMatches, ...contextMatches]) {
    const current = unique.get(entity.id)
    if (!current || compareEntities(entity, current) < 0) unique.set(entity.id, entity)
  }
  const entities = [...unique.values()].sort(compareEntities)
  const requiresClarification = entities.length > 1
    && entities[0].confidence === entities[1].confidence
    && entities[0].ambiguityKey === entities[1].ambiguityKey

  return {
    entities: entities.map(({ sourceOrder: _sourceOrder, ambiguityKey: _ambiguityKey, ...entity }) => entity),
    requiresClarification,
  }
}
