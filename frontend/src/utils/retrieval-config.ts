import type {
  RetrievalConfigResponse,
  RuntimeRetrievalSettings,
  RuntimeRetrievalSettingsPayload,
} from '../types/index.js'

export function parseRetrievalConfigResponse(value: unknown): RetrievalConfigResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('检索配置接口结构不兼容，请重启后端服务')
  }
  const candidate = value as Partial<RetrievalConfigResponse>
  const settings = candidate.settings as Partial<RuntimeRetrievalSettings> | undefined
  if (
    !settings
    || typeof settings.ragEnabled !== 'boolean'
    || !['bge', 'tfidf'].includes(String(settings.ragMode))
    || typeof settings.ragTopK !== 'number'
    || !Array.isArray(candidate.capabilities)
    || !Array.isArray(candidate.offlineArtifacts)
  ) {
    throw new Error('检索配置接口结构不兼容，请重启后端服务')
  }
  return candidate as RetrievalConfigResponse
}

export function toRuntimeSettingsPayload(
  settings: RuntimeRetrievalSettings,
): RuntimeRetrievalSettingsPayload {
  return {
    ragEnabled: settings.ragEnabled,
    ragMode: settings.ragMode,
    ragWeight: settings.ragWeight,
    ragTopK: settings.ragTopK,
    kgEnabled: settings.kgEnabled,
    kgWeight: settings.kgWeight,
    spatialEnabled: settings.spatialEnabled,
    spatialWeight: settings.spatialWeight,
    llmModel: settings.llmModel,
    maxTokens: settings.maxTokens,
    temperature: settings.temperature,
  }
}

function isWeight(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

export function validateRuntimeSettingsForm(
  settings: RuntimeRetrievalSettings,
): Partial<Record<keyof RuntimeRetrievalSettingsPayload, string>> {
  const errors: Partial<Record<keyof RuntimeRetrievalSettingsPayload, string>> = {}
  if (!Number.isInteger(settings.ragTopK) || settings.ragTopK < 1 || settings.ragTopK > 20) {
    errors.ragTopK = 'Top-K 必须是 1 到 20 的整数'
  }
  if (!isWeight(settings.ragWeight)) errors.ragWeight = 'RAG 权重必须在 0 到 1 之间'
  if (!isWeight(settings.kgWeight)) errors.kgWeight = '知识图谱权重必须在 0 到 1 之间'
  if (!isWeight(settings.spatialWeight)) errors.spatialWeight = '空间检索权重必须在 0 到 1 之间'
  if (!Number.isInteger(settings.maxTokens) || settings.maxTokens < 256 || settings.maxTokens > 8192) {
    errors.maxTokens = '最大 Token 必须是 256 到 8192 的整数'
  }
  if (!Number.isFinite(settings.temperature) || settings.temperature < 0 || settings.temperature > 1) {
    errors.temperature = 'Temperature 必须在 0 到 1 之间'
  }
  return errors
}
