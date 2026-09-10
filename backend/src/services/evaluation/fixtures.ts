import { evaluationSuiteSchema } from './schemas.js'
import type {
  EvaluationMode,
  EvaluationRunInput,
  PublicEvaluationSuite,
  SingleTurnEvaluationCase,
} from './types.js'

const MODES: EvaluationMode[] = ['direct', 'rag', 'kg', 'hybrid', 'agent']
const ENTITIES = Array.from({ length: 20 }, (_, index) => {
  const ordinal = index + 1
  return {
    id: `SYN-ENTITY-${String(ordinal).padStart(2, '0')}`,
    name: `Synthetic Aurora Deposit ${ordinal}`,
    documentId: `SYN-DOC-${String(ordinal).padStart(2, '0')}`,
    structureId: `SYN-STRUCTURE-${String(ordinal).padStart(2, '0')}`,
    structureName: `Synthetic Meridian Fault ${ordinal}`,
    regionId: `SYN-REGION-${String(ordinal).padStart(2, '0')}`,
    regionName: `Synthetic Northfield Region ${ordinal}`,
  }
})
const ENTITY_POOLS = {
  development: ENTITIES.slice(0, 10),
  test: ENTITIES.slice(10, 20),
} as const

const SUPPORTED_TEMPLATES = [
  { intent: 'geology_qa', tools: ['search_documents'], question: (name: string) => `What evidence describes ${name}?` },
  { intent: 'entity_lookup', tools: ['get_entity_detail'], question: (name: string) => `Show the entity detail for ${name}.` },
  { intent: 'spatial_analysis', tools: ['spatial_query'], question: (name: string) => `Which synthetic structures are near ${name}?` },
  { intent: 'region_comparison', tools: ['spatial_query', 'query_knowledge_graph'], question: (name: string, region: string) => `Compare ${name} with ${region}.` },
  { intent: 'geology_qa', tools: ['query_knowledge_graph'], question: (name: string, _region: string, structure: string) => `How is ${name} related to ${structure}?` },
  { intent: 'geology_qa', tools: ['search_documents', 'query_knowledge_graph'], question: (name: string) => `Summarize document and graph evidence for ${name}.` },
] as const

function supportedCases(): SingleTurnEvaluationCase[] {
  return (['development', 'test'] as const).flatMap((split, splitIndex) =>
    ENTITY_POOLS[split].slice(0, 5).flatMap((entity, entityIndex) =>
      SUPPORTED_TEMPLATES.map((template, templateIndex) => {
        const splitOrdinal = entityIndex * SUPPORTED_TEMPLATES.length + templateIndex
        const ordinal = splitIndex * 30 + splitOrdinal
        return {
          id: `supported-${String(ordinal + 1).padStart(3, '0')}`,
          split,
          kind: 'supported',
          synthetic: true,
          question: template.question(entity.name, entity.regionName, entity.structureName),
          evaluationMode: MODES[ordinal % MODES.length]!,
          expectedIntent: template.intent,
          expectedTools: [...template.tools],
          expectedEntityId: entity.id,
          expectedStructureId: entity.structureId,
          expectedRegionId: entity.regionId,
          relevantDocumentIds: [entity.documentId],
          acceptedCitationIds: [`D${ordinal + 1}-P1`, 'KG1'],
          humanBlindReview: null,
        }
      }),
    ),
  )
}

function refusalCases(): SingleTurnEvaluationCase[] {
  return (['development', 'test'] as const).flatMap((split, splitIndex) =>
    Array.from({ length: 10 }, (_, splitOrdinal) => {
      const index = splitIndex * 10 + splitOrdinal
      const entity = ENTITY_POOLS[split][splitOrdinal]!
      return {
        id: `refusal-${String(index + 1).padStart(3, '0')}`,
        split,
        kind: 'refusal',
        synthetic: true,
        question: index % 2 === 0
          ? `Give the verified reserve tonnage for ${entity.name}, although no reserve evidence exists.`
          : `State the 2035 production output for ${entity.name}, although no production evidence exists.`,
        evaluationMode: MODES[index % MODES.length]!,
        expectedIntent: 'geology_qa',
        expectedTools: index % 2 === 0 ? ['search_documents'] : ['query_knowledge_graph'],
        expectedEntityId: entity.id,
        expectedStructureId: entity.structureId,
        expectedRegionId: entity.regionId,
        relevantDocumentIds: [],
        acceptedCitationIds: [],
        humanBlindReview: null,
      } satisfies SingleTurnEvaluationCase
    }),
  )
}

export function buildPublicEvaluationSuite(): PublicEvaluationSuite {
  const suite: PublicEvaluationSuite = {
    schemaVersion: '1.0',
    synthetic: true,
    singleTurnCases: [...supportedCases(), ...refusalCases()],
    multiTurnCases: (['development', 'test'] as const).flatMap((split, splitIndex) =>
      Array.from({ length: 10 }, (_, splitOrdinal) => {
        const index = splitIndex * 10 + splitOrdinal
        const pool = ENTITY_POOLS[split]
        const primary = pool[splitOrdinal]!
        const secondary = pool[(splitOrdinal + 1) % pool.length]!
        return {
          id: `multi-${String(index + 1).padStart(3, '0')}`,
          split,
          synthetic: true,
          turns: [
            {
              id: `multi-${index + 1}-turn-1`, question: `Introduce ${primary.name}.`,
              expectedIntent: 'entity_lookup', expectedTools: ['get_entity_detail'], expectedEntityId: primary.id,
              expectedStructureId: primary.structureId, expectedRegionId: primary.regionId,
            },
            {
              id: `multi-${index + 1}-turn-2`, question: 'Which structure controls it?',
              expectedIntent: 'geology_qa', expectedTools: ['query_knowledge_graph'], expectedEntityId: primary.id,
              expectedStructureId: primary.structureId, expectedRegionId: primary.regionId,
            },
            {
              id: `multi-${index + 1}-turn-3`, question: `Compare it with ${secondary.name}.`,
              expectedIntent: 'region_comparison', expectedTools: ['query_knowledge_graph'], expectedEntityId: primary.id,
              expectedStructureId: primary.structureId, expectedRegionId: primary.regionId,
            },
          ],
          humanBlindReview: null,
        }
      }),
    ),
  }
  evaluationSuiteSchema.parse(suite)
  return suite
}

export function buildSyntheticValidationRun(
  suite: PublicEvaluationSuite,
  split: 'development' | 'test' = 'test',
): EvaluationRunInput {
  const singleTurnCases = suite.singleTurnCases.filter((item) => item.split === split)
  const multiTurnCases = suite.multiTurnCases.filter((item) => item.split === split)
  return {
    suite,
    singleTurnResults: singleTurnCases.map((item, index) => ({
      caseId: item.id,
      retrievedDocumentIds: item.relevantDocumentIds,
      predictedIntent: item.expectedIntent,
      selectedTools: item.expectedTools,
      ...(item.expectedEntityId ? { linkedEntityId: item.expectedEntityId } : {}),
      citationIds: item.kind === 'supported' ? item.acceptedCitationIds.slice(0, 1) : [],
      refused: item.kind === 'refusal',
      answeredFactually: item.kind === 'supported',
      totalClaims: item.kind === 'supported' ? 2 : 0,
      unsupportedClaims: 0,
      directBaselineTotalClaims: 2,
      directBaselineUnsupportedClaims: 1,
      latencyMs: 80 + index,
    })),
    multiTurnResults: multiTurnCases.map((item, index) => ({
      caseId: item.id,
      turnSuccess: item.turns.map(() => true),
      latencyMs: 240 + index * 5,
    })),
  }
}
