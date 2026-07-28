import { config } from '../config.js'
import type { Chunk, Source, KGPath, RetrievalMode, SpatialAnalysis, SpatialData } from '../types/index.js'
import { gateway } from './llm/gateway.js'
import { DeepSeekProvider } from './llm/deepseek.js'
import { TongyiProvider } from './llm/tongyi.js'
import type { LLMToolCall, LLMToolDefinition } from './llm/provider.js'

// ============================================================
// 初始化：注册已配置的 LLM Provider
// ============================================================

// DeepSeek（主模型）
if (config.deepseek.apiKey && config.deepseek.apiKey !== 'sk-placeholder') {
  gateway.register(new DeepSeekProvider({
    apiKey: config.deepseek.apiKey,
    model: config.deepseek.model,
    baseURL: config.deepseek.baseURL,
  }))
}

// 通义千问（备用模型 — 仅在配置了 key 时激活）
if (config.tongyi?.apiKey && config.tongyi.apiKey !== 'sk-your-tongyi-key-here') {
  gateway.register(new TongyiProvider({
    apiKey: config.tongyi.apiKey,
    model: config.tongyi.model,
    baseURL: config.tongyi.baseURL,
  }))
}

console.log(`[llm] 已注册 ${gateway.getProviders().length} 个 Provider: ${gateway.getProviders().join(', ') || '无（使用 mock 降级）'}`)

// ============================================================
// Prompt 构建
// ============================================================

export const SYSTEM_PROMPT =
  '你是专业的地质找矿知识问答助手。必须基于提供的地质文献和真实知识图谱证据回答。先给结论，再解释与问题直接相关的要点；不堆砌检索片段，不重复界面已经展示的来源、本体、图谱或地图信息。信息不完整时说明证据边界，完全没有相关信息时才说明知识库暂未收录。地学术语首次出现时可附一句简释。'

const OWL_TYPE_CN: Record<string, string> = {
  RockHostedMineral: '具有赋存岩石证据的矿产',
  StructurallyControlledMineral: '具有构造控制证据的矿产',
  AgeConstrainedMineral: '具有形成时代证据的矿产',
}

function formatOwlTypes(types?: string[]): string {
  if (!types?.length) return ''
  const labels = types.map((type) => OWL_TYPE_CN[type] || type)
  return `（OWL推理类别：${labels.join('、')}）`
}

export function buildPrompt(
  question: string,
  ragChunks: { chunk: Chunk; score: number }[],
  kgContext: KGPath[],
  retrievalMode: RetrievalMode = 'hybrid',
  spatialContext?: { data: SpatialData; analysis: SpatialAnalysis },
): string {
  const showRag = retrievalMode === 'rag' || retrievalMode === 'hybrid'
  const showKg = retrievalMode === 'kg' || retrievalMode === 'hybrid'
  const factualKgContext = kgContext.filter((path) => !path.isMock)

  let ragSection = ''
  if (showRag && ragChunks.length > 0) {
    ragSection = `## 文档检索上下文（RAG — 地质调查报告/区域地质文献）
${ragChunks
      .map(
        (r) =>
          `[D${r.chunk.id}-P${r.chunk.page}]（文档证据，相关度: ${(r.score * 100).toFixed(1)}%）\n${r.chunk.content}`
      )
      .join('\n\n')}`
  }

  let kgSection = ''
  if (showKg && factualKgContext.length > 0) {
    kgSection = `## 知识图谱上下文（KG — 岩石-构造-矿产-地质年代关系）
${factualKgContext
      .map((p, index) => {
        const relationKind = p.inferred ? '，该关系由OWL规则推得' : ''
        return `- [KG${index + 1}] 「${p.from}」${formatOwlTypes(p.fromOwlTypes)}—[${p.relation}${relationKind}]→「${p.to}」${formatOwlTypes(p.toOwlTypes)}`
      })
      .join('\n')}`
  }

  let spatialSection = ''
  if (spatialContext
    && spatialContext.analysis.interpretation.spatialIntent
    && spatialContext.analysis.summary.matchedCount > 0) {
    const { interpretation, summary } = spatialContext.analysis
    const filters = [
      interpretation.anchorName ? `参照：${interpretation.anchorName}` : '',
      interpretation.radiusKm ? `范围：${interpretation.radiusKm} 千米` : '',
      interpretation.mineralKinds.length ? `矿种：${interpretation.mineralKinds.join('、')}` : '',
      interpretation.timePeriods.length ? `时代：${interpretation.timePeriods.join('、')}` : '',
    ].filter(Boolean).join('；')
    const points = spatialContext.data.markers.slice(0, 20).map((point) => {
      const distance = point.distanceKm === undefined ? '' : `，距参照 ${point.distanceKm.toFixed(2)} 千米`
      const score = point.prospectivity ? `，演示有利度 ${point.prospectivity.score} 分（${point.prospectivity.level}）` : ''
      const mock = point.isMock ? '，功能演示数据' : '，Neo4j坐标数据'
      const evidence = [point.era, point.depositType, point.region].filter(Boolean).join('，')
      return `- 「${point.name}」${distance}${score}${evidence ? `（${evidence}）` : ''}${mock}`
    }).join('\n')
    const temporal = spatialContext.analysis.temporal.buckets
      .slice(0, 12)
      .map((bucket) => `${bucket.era} ${bucket.count} 个`)
      .join('；')
    const regions = spatialContext.analysis.regions
      .slice(0, 10)
      .map((region) => `${region.region} ${region.count} 个${region.averageProspectivityScore === undefined ? '' : `，演示有利度均分 ${region.averageProspectivityScore}`}${region.dominantEra ? `，主要年代 ${region.dominantEra}` : ''}`)
      .join('；')
    spatialSection = `## 空间分析上下文（距离和范围由后端计算）
解析条件：${filters || '空间分布查询'}
结果：${summary.pointCount} 个点、${summary.lineCount} 条构造线；其中 ${summary.mockCount} 个为功能演示要素。
${regions ? `区域对比：${regions}\n` : ''}${temporal ? `年代证据分布：${temporal}\n` : ''}${spatialContext.analysis.temporal.unknownEraCount ? `缺少年代属性：${spatialContext.analysis.temporal.unknownEraCount} 个\n` : ''}${points}
重要：带“功能演示数据”的结果只能用于说明系统空间分析能力，回答中必须明确标注为演示数据，不得表述为真实勘查发现。`
  }

  const contextSections = [ragSection, kgSection, spatialSection].filter(Boolean).join('\n\n')
  const contextIntro = contextSections
    ? `你的回答基于以下上下文：\n\n${contextSections}`
    : '当前未检索到相关上下文，请根据你的地质知识尽力回答。'

  return `你是一个地质找矿领域的智能问答助手。${contextIntro}

## 用户问题
${question}

## 回答要求
1. 开头用 1 至 2 句话直接回答用户问题
2. 仅在确有多个并列结论时使用 2 至 4 个无序要点，每个要点不超过 2 句
3. 普通问题以 300 至 500 个汉字为目标；复杂对比、空间分析或明确要求详细说明时可以更长
4. 只保留与问题直接相关的证据，不主动扩展岩体尺寸、矿段清单、围岩机制或空间统计
5. 结尾最多使用 1 句总结，不列“关键地质实体”，不重复界面组件已经展示的信息
6. 禁止用“根据您提供的资料”开头，禁止用“现有资料还覆盖了以下相关信息”扩写
7. OWL类别只表示对应证据存在，不得据此虚构成因或把围岩年代当作成矿年代
8. 空间结果只在明确的位置、范围、距离、地图或空间分析问题中用于正文
9. 每个事实性结论必须紧跟一个最直接的证据引用，只能使用上下文给出的 [D数字-P数字] 或 [KG数字] 标识；无可靠证据时明确拒答`
}

// ============================================================
// 公开 API（委托给 Gateway）
// ============================================================

/** 非流式生成回答 */
export async function generateAnswer(
  question: string,
  ragChunks: { chunk: Chunk; score: number }[],
  kgContext: KGPath[],
  retrievalMode: RetrievalMode = 'hybrid',
  spatialContext?: { data: SpatialData; analysis: SpatialAnalysis },
): Promise<{ answer: string; sources: Source[] }> {
  return gateway.generateAnswer(
    question,
    ragChunks,
    kgContext,
    retrievalMode,
    spatialContext,
  )
}

export async function generateAgentToolCalls(
  systemPrompt: string,
  userPrompt: string,
  definitions: LLMToolDefinition[],
): Promise<LLMToolCall[]> {
  return gateway.generateToolCalls(systemPrompt, userPrompt, definitions)
}

/** SSE 流式生成回答 */
export async function generateAnswerStream(
  question: string,
  ragChunks: { chunk: Chunk; score: number }[],
  kgContext: KGPath[],
  retrievalMode: RetrievalMode = 'hybrid',
  spatialContext: { data: SpatialData; analysis: SpatialAnalysis } | undefined,
  callbacks: {
    onChunk: (text: string) => void
    onDone: (sources: Source[]) => void
    onError: (err: Error) => void
  }
): Promise<void> {
  return gateway.generateAnswerStream(
    question,
    ragChunks,
    kgContext,
    retrievalMode,
    spatialContext,
    callbacks,
  )
}
