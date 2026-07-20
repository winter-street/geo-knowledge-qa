import { config } from '../config.js'
import { getRuntimeSettingsRepository } from '../db/sqlite.js'

export interface RuntimeSettings {
  ragEnabled: boolean
  ragMode: 'bge' | 'tfidf'
  ragWeight: number
  ragTopK: number
  kgEnabled: boolean
  kgWeight: number
  spatialEnabled: boolean
  spatialWeight: number
  llmModel: string
  maxTokens: number
  temperature: number
  updatedAt: string | null
  updatedBy: string | null
}

export type RuntimeSettingsInput = Omit<RuntimeSettings, 'updatedAt' | 'updatedBy'>

export interface RuntimeSettingsRepository {
  load(): RuntimeSettings | null
  save(settings: RuntimeSettings): void
}

export interface RuntimeSettingsManager {
  get(): RuntimeSettings
  update(input: Partial<RuntimeSettingsInput>, updatedBy: string): RuntimeSettings
}

const supportedModels = new Set([
  'deepseek-chat',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
])

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  ragEnabled: true,
  ragMode: process.env.RETRIEVAL_MODE === 'tfidf' ? 'tfidf' : 'bge',
  ragWeight: 0.35,
  ragTopK: config.retrieval.topK,
  kgEnabled: true,
  kgWeight: 0.4,
  spatialEnabled: true,
  spatialWeight: 0.25,
  llmModel: config.deepseek.model,
  maxTokens: 2048,
  temperature: 0.3,
  updatedAt: null,
  updatedBy: null,
}

const editableKeys = new Set<keyof RuntimeSettingsInput>([
  'ragEnabled', 'ragMode', 'ragWeight', 'ragTopK',
  'kgEnabled', 'kgWeight', 'spatialEnabled', 'spatialWeight',
  'llmModel', 'maxTokens', 'temperature',
])

function requireBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值`)
}

function requireWeight(value: unknown, label: string): asserts value is number {
  if (!Number.isFinite(value) || Number(value) < 0 || Number(value) > 1) {
    throw new Error(`${label}必须在 0 到 1 之间`)
  }
}

export function validateRuntimeSettings(settings: RuntimeSettings): RuntimeSettings {
  requireBoolean(settings.ragEnabled, 'RAG 开关')
  if (!['bge', 'tfidf'].includes(settings.ragMode)) {
    throw new Error('RAG 模式只能是 bge 或 tfidf')
  }
  requireWeight(settings.ragWeight, 'RAG 权重')
  if (!Number.isInteger(settings.ragTopK) || settings.ragTopK < 1 || settings.ragTopK > 20) {
      throw new Error('Top-K 必须是 1 到 20 的整数')
  }
  requireBoolean(settings.kgEnabled, '知识图谱开关')
  requireWeight(settings.kgWeight, '知识图谱权重')
  requireBoolean(settings.spatialEnabled, '空间检索开关')
  requireWeight(settings.spatialWeight, '空间检索权重')
  if (!supportedModels.has(settings.llmModel)) {
    throw new Error('不支持的 DeepSeek 模型')
  }
  if (!Number.isInteger(settings.maxTokens) || settings.maxTokens < 256 || settings.maxTokens > 8192) {
    throw new Error('最大 Token 必须是 256 到 8192 的整数')
  }
  if (!Number.isFinite(settings.temperature) || settings.temperature < 0 || settings.temperature > 1) {
    throw new Error('Temperature 必须在 0 到 1 之间')
  }
  return { ...settings }
}

export function createRuntimeSettingsManager(
  repository: RuntimeSettingsRepository,
  defaults: RuntimeSettings = DEFAULT_RUNTIME_SETTINGS,
): RuntimeSettingsManager {
  let settings = validateRuntimeSettings(repository.load() ?? defaults)

  return {
    get: () => ({ ...settings }),
    update(input, updatedBy) {
      for (const key of Object.keys(input)) {
        if (!editableKeys.has(key as keyof RuntimeSettingsInput)) {
          throw new Error(`不支持的配置字段：${key}`)
        }
      }
      const next = validateRuntimeSettings({
        ...settings,
        ...input,
        updatedAt: new Date().toISOString(),
        updatedBy: updatedBy.trim() || 'unknown',
      })
      repository.save(next)
      settings = next
      return { ...settings }
    },
  }
}

const manager = createRuntimeSettingsManager(getRuntimeSettingsRepository())

export function getRuntimeSettings(): Readonly<RuntimeSettings> {
  return manager.get()
}

export function updateRuntimeSettings(
  input: Partial<RuntimeSettingsInput>,
  updatedBy = 'system',
): RuntimeSettings {
  return manager.update(input, updatedBy)
}
