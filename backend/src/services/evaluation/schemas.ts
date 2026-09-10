import { z } from 'zod'

const intentSchema = z.enum([
  'geology_qa', 'entity_lookup', 'spatial_analysis',
  'region_comparison', 'chitchat', 'clarification',
])
const toolSchema = z.enum([
  'search_documents', 'query_knowledge_graph', 'spatial_query', 'get_entity_detail',
])
const splitSchema = z.enum(['development', 'test'])

export const singleTurnCaseSchema = z.object({
  id: z.string().min(1),
  split: splitSchema,
  kind: z.enum(['supported', 'refusal']),
  synthetic: z.literal(true),
  question: z.string().min(1),
  evaluationMode: z.enum(['direct', 'rag', 'kg', 'hybrid', 'agent']),
  expectedIntent: intentSchema,
  expectedTools: z.array(toolSchema),
  expectedEntityId: z.string().min(1).optional(),
  expectedStructureId: z.string().min(1).optional(),
  expectedRegionId: z.string().min(1).optional(),
  relevantDocumentIds: z.array(z.string().min(1)),
  acceptedCitationIds: z.array(z.string().regex(/^(D\d+-P\d+|KG\d+)$/)),
  humanBlindReview: z.object({
    status: z.enum(['pending', 'complete']),
    reviewer: z.string().nullable(),
    notes: z.string().nullable(),
  }).nullable(),
})

export const multiTurnCaseSchema = z.object({
  id: z.string().min(1),
  split: splitSchema,
  synthetic: z.literal(true),
  turns: z.array(z.object({
    id: z.string().min(1),
    question: z.string().min(1),
    expectedIntent: intentSchema,
    expectedTools: z.array(toolSchema),
    expectedEntityId: z.string().min(1).optional(),
    expectedStructureId: z.string().min(1).optional(),
    expectedRegionId: z.string().min(1).optional(),
  })).length(3),
  humanBlindReview: z.object({
    status: z.enum(['pending', 'complete']),
    reviewer: z.string().nullable(),
    notes: z.string().nullable(),
  }).nullable(),
})

export const evaluationSuiteSchema = z.object({
  schemaVersion: z.literal('1.0'),
  synthetic: z.literal(true),
  singleTurnCases: z.array(singleTurnCaseSchema).length(80),
  multiTurnCases: z.array(multiTurnCaseSchema).length(20),
}).superRefine((suite, context) => {
  const supported = suite.singleTurnCases.filter((item) => item.kind === 'supported').length
  const refusal = suite.singleTurnCases.filter((item) => item.kind === 'refusal').length
  if (supported !== 60 || refusal !== 20) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Evaluation suite must contain exactly 60 supported and 20 refusal cases.',
      path: ['singleTurnCases'],
    })
  }
  for (const split of splitSchema.options) {
    const singleCount = suite.singleTurnCases.filter((item) => item.split === split).length
    if (singleCount !== 40) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Evaluation suite must contain exactly 40 single-turn cases per split.',
        path: ['singleTurnCases'],
      })
    }
    const supportedCount = suite.singleTurnCases
      .filter((item) => item.split === split && item.kind === 'supported').length
    const refusalCount = suite.singleTurnCases
      .filter((item) => item.split === split && item.kind === 'refusal').length
    if (supportedCount !== 30 || refusalCount !== 10) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Evaluation suite must contain exactly 30 supported and 10 refusal cases per split.',
        path: ['singleTurnCases'],
      })
    }
    const multiCount = suite.multiTurnCases.filter((item) => item.split === split).length
    if (multiCount !== 10) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Evaluation suite must contain exactly 10 multi-turn cases per split.',
        path: ['multiTurnCases'],
      })
    }
  }
  const splitIdentifiers = (split: 'development' | 'test', field: 'expectedEntityId' | 'expectedStructureId' | 'expectedRegionId' | 'relevantDocumentIds') => {
    const single = suite.singleTurnCases.filter((item) => item.split === split)
    const multi = suite.multiTurnCases.filter((item) => item.split === split)
    if (field === 'relevantDocumentIds') return new Set(single.flatMap((item) => item.relevantDocumentIds))
    return new Set([
      ...single.flatMap((item) => item[field] ?? []),
      ...multi.flatMap((item) => item.turns.flatMap((turn) => turn[field] ?? [])),
    ])
  }
  const isolationChecks = [
    ['expectedEntityId', 'entity'] as const,
    ['relevantDocumentIds', 'document'] as const,
    ['expectedStructureId', 'structure'] as const,
    ['expectedRegionId', 'region'] as const,
  ]
  for (const [field, label] of isolationChecks) {
    const developmentIds = splitIdentifiers('development', field)
    const testIds = splitIdentifiers('test', field)
    if ([...developmentIds].some((id) => testIds.has(id))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Development and test ${label} IDs must not overlap.`,
        path: [field],
      })
    }
  }
})

export const singleTurnResultSchema = z.object({
  caseId: z.string().min(1),
  retrievedDocumentIds: z.array(z.string().min(1)),
  predictedIntent: intentSchema,
  selectedTools: z.array(toolSchema),
  linkedEntityId: z.string().min(1).optional(),
  citationIds: z.array(z.string().regex(/^(D\d+-P\d+|KG\d+)$/)),
  refused: z.boolean(),
  answeredFactually: z.boolean(),
  totalClaims: z.number().int().nonnegative(),
  unsupportedClaims: z.number().int().nonnegative(),
  directBaselineTotalClaims: z.number().int().nonnegative(),
  directBaselineUnsupportedClaims: z.number().int().nonnegative(),
  latencyMs: z.number().finite().nonnegative(),
}).superRefine((result, context) => {
  if (result.unsupportedClaims > result.totalClaims) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Unsupported claims cannot exceed total claims.',
      path: ['unsupportedClaims'],
    })
  }
  if (result.directBaselineUnsupportedClaims > result.directBaselineTotalClaims) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Direct baseline unsupported claims cannot exceed total claims.',
      path: ['directBaselineUnsupportedClaims'],
    })
  }
})

export const multiTurnResultSchema = z.object({
  caseId: z.string().min(1),
  turnSuccess: z.array(z.boolean()),
  latencyMs: z.number().finite().nonnegative(),
})

export const evaluationRunInputSchema = z.object({
  suite: evaluationSuiteSchema,
  singleTurnResults: z.array(singleTurnResultSchema),
  multiTurnResults: z.array(multiTurnResultSchema),
})
