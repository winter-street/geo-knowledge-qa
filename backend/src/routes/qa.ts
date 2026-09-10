import { Router, type Request, type Response } from 'express'
import { search, toSources } from '../services/tfidf.js'
import { searchEntitiesWithStatus } from '../services/kg.js'
import { generateAnswer, generateAnswerStream } from '../services/llm.js'
import { getRuntimeSettings } from '../services/runtime-settings.js'
import { insertQaLog } from '../db/sqlite.js'
import { resolveSpatialForQuestion } from '../services/spatial.js'
import { buildMapPlan } from '../services/map-plan.js'
import { handleAgentQa } from './qa-agent.js'
import type { JwtPayload } from '../middleware/auth.js'
import {
  buildPathUsed,
  hasAvailableRetrievalPath,
  resolveRetrievalPolicy,
} from '../services/retrieval-policy.js'
import {
  finalizeRetrievalResults,
  ragCandidateTopK,
} from '../services/retrieval-fusion.js'
import { rerankDocuments } from '../services/reranker-client.js'
import { groundAnswer } from '../services/grounding.js'
import type { QaAskRequest, QaAskResponse, RetrievalMode } from '../types/index.js'

const router = Router()

/**
 * POST /api/qa/ask
 *
 * 核心问答接口：双路并行检索（RAG + KG）→ LLM 生成回答
 * （空间检索已屏蔽，坐标数据就绪后恢复）
 *
 * 请求体:
 *   { question: string, stream?: boolean }
 *   stream=false → 普通 JSON 响应（默认，含 spatialData 字段，当前为空）
 *   stream=true  → SSE 流式响应（text/event-stream）
 */
router.post('/qa/ask', async (req: Request, res: Response) => {
  try {
    const {
      question,
      stream: useStream,
      retrievalMode = 'hybrid',
      agentMode = 'direct',
    } = req.body as QaAskRequest

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      res.status(400).json({ error: '问题不能为空' })
      return
    }
    if (!['rag', 'kg', 'hybrid'].includes(retrievalMode)) {
      res.status(400).json({ error: '检索模式只能是 rag、kg 或 hybrid' })
      return
    }
    if (!['direct', 'agent'].includes(agentMode)) {
      res.status(400).json({ error: 'agentMode must be direct or agent' })
      return
    }

    if (agentMode === 'agent') {
      await handleAgentQa({
        user: (req as Request & { user?: JwtPayload }).user,
        body: { ...req.body, question: question.trim(), retrievalMode, agentMode },
      }, res)
      return
    }

    const trimmedQuestion = question.trim()
    const runtimeSettings = getRuntimeSettings()
    const policy = resolveRetrievalPolicy(retrievalMode as RetrievalMode, runtimeSettings)
    if (!policy.useRag && !policy.useKg && !policy.useSpatial) {
      res.status(503).json({ error: '当前没有可用的检索路径，请联系管理员检查检索配置' })
      return
    }

    const candidateTopK = ragCandidateTopK(policy)
    const [ragSearch, kgSearch, spatialResult] = await Promise.all([
      policy.useRag
        ? search(trimmedQuestion, candidateTopK, policy.ragMode)
        : Promise.resolve({ results: [], mode: policy.ragMode, succeeded: false, reason: undefined }),
      policy.useKg
        ? searchEntitiesWithStatus(trimmedQuestion)
        : Promise.resolve({ results: [], succeeded: false, reason: undefined }),
      policy.useSpatial
        ? resolveSpatialForQuestion(trimmedQuestion)
        : Promise.resolve({
            data: { markers: [], polylines: [] },
            source: 'none' as const,
            analysis: undefined,
          }),
    ])

    if (!hasAvailableRetrievalPath(policy, {
      ragSucceeded: ragSearch.succeeded,
      kgSucceeded: kgSearch.succeeded,
      spatialSucceeded: policy.useSpatial,
    })) {
      res.status(503).json({
        error: '当前没有可用的检索路径，请联系管理员检查检索配置',
        reasons: [ragSearch.reason, kgSearch.reason].filter(Boolean),
      })
      return
    }

    const kgContext = kgSearch.results
    const rawRagResults = ragSearch.results
    const externalRerank = await rerankDocuments(trimmedQuestion, rawRagResults.slice(0, 20), 20)
    const rerankInput = externalRerank.status.mode === 'bge-reranker'
      ? externalRerank.results
      : rawRagResults
    const ragResults = finalizeRetrievalResults(
      trimmedQuestion,
      rerankInput,
      kgContext,
      policy,
    )

    const spatialData = spatialResult.data
    const spatialAnalysis = spatialResult.analysis
    const spatialCount = (spatialData.markers?.length ?? 0) + (spatialData.polylines?.length ?? 0)
    const mapPlan = buildMapPlan(trimmedQuestion, spatialAnalysis)

    const topScore = rawRagResults[0]?.score ?? 0
    console.log(
      `[qa] 请求模式: ${retrievalMode} | RAG: ${policy.ragMode}/${policy.useRag ? 'on' : 'off'} | `
      + `问题: "${trimmedQuestion.slice(0, 50)}..." → RAG: ${ragResults.length} (top ${topScore.toFixed(3)}), `
      + `KG: ${kgContext.length}, 空间: ${spatialCount}`
    )

    // 低相关度只基于本次实际启用的路径判断。
    const isLowRelevance =
      (!policy.useRag || topScore < 0.04)
      && (!policy.useKg || kgContext.length === 0)
      && (!policy.useSpatial || spatialCount === 0)

    if (isLowRelevance) {
      // 闲聊 / 低相关度：不展示地图（避免兜底 mock 误显）
      const emptySpatial = { markers: [], polylines: [] }
      const greeting = {
        answer: '您好！我是地质找矿知识问答助手。您可以向我提问关于矿产分布、断裂带控矿、成矿年代、岩石类型、构造特征等专业问题。',
        sources: [],
        citations: [],
        kgContext: [],
        spatialData: emptySpatial,
      }
      if (useStream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: greeting.answer })}\n\n`)
        res.write(`data: ${JSON.stringify({ type: 'done', sources: [], citations: [], kgContext: [], spatialData: emptySpatial })}\n\n`)
        res.end()
      } else {
        res.json(greeting)
      }
      return
    }

    // ========== 流式模式 ==========
    const t0 = Date.now()
    if (useStream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      // 先发送检索元信息
      const meta = {
        type: 'meta',
        ragCount: ragResults.length,
        kgCount: kgContext.length,
        spatialCount,
        kgContext,
        spatialData,
        spatialAnalysis,
        mapPlan,
        retrievalPolicy: policy,
      }
      res.write(`data: ${JSON.stringify(meta)}\n\n`)

      const bufferedChunks: string[] = []
      let bufferedSources: QaAskResponse['sources'] = []
      let streamError: Error | undefined
      await generateAnswerStream(
        trimmedQuestion,
        ragResults,
        kgContext,
        retrievalMode,
        spatialAnalysis ? { data: spatialData, analysis: spatialAnalysis } : undefined,
        {
        onChunk(text) {
          bufferedChunks.push(text)
        },
        onDone(sources) {
          bufferedSources = sources
        },
        onError(err) {
          streamError = err
        },
        },
      )
      if (streamError) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: streamError.message })}\n\n`)
        res.end()
        return
      }
      const grounded = groundAnswer(bufferedChunks.join(''), ragResults, kgContext)
      for (const content of grounded.answer.match(/.{1,160}/gu) ?? [grounded.answer]) {
        res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`)
      }
      const finalSources = bufferedSources.length > 0 ? bufferedSources : toSources(ragResults)
      const pathUsed = buildPathUsed({
        policy,
        ragSucceeded: ragSearch.succeeded,
        ragCount: ragResults.length,
        kgCount: kgContext.length,
        spatialCount,
      })
      insertQaLog({
        id: `qa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        question: trimmedQuestion,
        pathUsed,
        hitDocs: ragResults.length,
        kgCount: kgContext.length,
        spatialCount,
        latency: Date.now() - t0,
        ragMode: policy.ragMode,
        ragWeight: policy.ragWeight,
        kgWeight: policy.kgWeight,
        spatialWeight: policy.spatialWeight,
      })
      res.write(`data: ${JSON.stringify({ type: 'done', sources: finalSources, citations: grounded.citations, kgContext, spatialData, spatialAnalysis, mapPlan })}\n\n`)
      res.end()
      return
    }

    // ========== 普通模式 ==========
    const { answer, sources } = await generateAnswer(
      trimmedQuestion,
      ragResults,
      kgContext,
      retrievalMode,
      spatialAnalysis ? { data: spatialData, analysis: spatialAnalysis } : undefined,
    )
    const grounded = groundAnswer(answer, ragResults, kgContext)
    const latency = Date.now() - t0

    // 写入问答日志
    const pathUsed = buildPathUsed({
      policy,
      ragSucceeded: ragSearch.succeeded,
      ragCount: ragResults.length,
      kgCount: kgContext.length,
      spatialCount,
    })
    insertQaLog({
      id: `qa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      question: trimmedQuestion,
      pathUsed,
      hitDocs: ragResults.length,
      kgCount: kgContext.length,
      spatialCount,
      latency,
      ragMode: policy.ragMode,
      ragWeight: policy.ragWeight,
      kgWeight: policy.kgWeight,
      spatialWeight: policy.spatialWeight,
    })

    const response: QaAskResponse = {
      answer: grounded.answer,
      sources: sources.length > 0 ? sources : toSources(ragResults),
      citations: grounded.citations,
      kgContext,
      spatialData,
      spatialAnalysis,
      mapPlan,
    }

    res.json(response)
  } catch (err) {
    console.error('[qa] 请求处理失败:', err)
    res.status(500).json({ error: '服务内部错误' })
  }
})

/**
 * GET /api/qa/history
 *
 * 对话历史（前端 localStorage 持久化，后端暂返回空数组）
 */
router.get('/qa/history', (_req: Request, res: Response) => {
  res.json([])
})

export default router
