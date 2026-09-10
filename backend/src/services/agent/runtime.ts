import { getAppStateStore } from '../../db/app-state.js'
import { findEntityCandidates, getEntityDetail, searchEntitiesWithStatus } from '../kg.js'
import { resolveSpatialForQuestion } from '../spatial.js'
import { search } from '../tfidf.js'
import { rerankDocuments } from '../reranker-client.js'
import { rerankRagResults } from '../rag-reranker.js'
import { selectDiverseEvidence } from '../evidence-selection.js'
import type { AgentOrchestratorDependencies } from './orchestrator.js'
import { createAgentToolRegistry } from './tools.js'
import { createLlmAgentPlanner } from './llm-planner.js'
import { generateAgentToolCalls } from '../llm.js'

let runtimeDependencies: AgentOrchestratorDependencies | undefined

export interface AgentRuntimeToolAdapters {
  search: typeof search
  rerank: typeof rerankDocuments
  searchEntities: typeof searchEntitiesWithStatus
  spatialQuery: typeof resolveSpatialForQuestion
  getEntityDetail: typeof getEntityDetail
}

const defaultToolAdapters: AgentRuntimeToolAdapters = {
  search,
  rerank: rerankDocuments,
  searchEntities: searchEntitiesWithStatus,
  spatialQuery: resolveSpatialForQuestion,
  getEntityDetail,
}

export function createAgentRuntimeToolRegistry(adapters: AgentRuntimeToolAdapters = defaultToolAdapters) {
  return createAgentToolRegistry({
    async searchDocuments(args) {
      const result = await adapters.search(args.query, 20, args.retrievalMode)
      const reranked = await adapters.rerank(args.query, result.results, 20)
      const candidates = reranked.status.mode === 'bge-reranker'
        ? reranked.results
        : rerankRagResults(args.query, result.results, [], result.results.length)
      const evidence = selectDiverseEvidence(candidates, 5, 2)
      return {
        output: { ...result, results: evidence, rerankerStatus: reranked.status },
        evidenceCount: evidence.length,
      }
    },
    async queryKnowledgeGraph(args) {
      const result = await adapters.searchEntities(args.question)
      return { output: result, evidenceCount: result.results.length }
    },
    async spatialQuery(args) {
      const result = await adapters.spatialQuery(args.question)
      const evidenceCount = result.data.markers.length + result.data.polylines.length
      return { output: result, evidenceCount }
    },
    async getEntityDetail(args) {
      const result = await adapters.getEntityDetail(args.entityId)
      return { output: result, evidenceCount: result ? 1 : 0 }
    },
  })
}

export function getAgentRuntimeDependencies(): AgentOrchestratorDependencies {
  if (runtimeDependencies) return runtimeDependencies
  const registry = createAgentRuntimeToolRegistry()
  runtimeDependencies = {
    store: getAppStateStore(),
    registry,
    findCandidates: findEntityCandidates,
    toolTimeoutMs: 10_000,
    runTimeoutMs: 60_000,
    planWithModel: createLlmAgentPlanner(generateAgentToolCalls),
  }
  return runtimeDependencies
}
