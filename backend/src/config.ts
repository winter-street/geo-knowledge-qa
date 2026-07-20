import dotenv from 'dotenv'
import type { AppConfig } from './types/index.js'

dotenv.config()

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    console.warn(`[config] 缺少环境变量 ${key}，使用默认值`)
    return ''
  }
  return value
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),

  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    user: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password',
  },

  deepseek: {
    apiKey: requireEnv('DEEPSEEK_API_KEY'),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  },

  tongyi: {
    apiKey: process.env.TONGYI_API_KEY || '',
    model: process.env.TONGYI_MODEL || 'qwen-plus',
    baseURL: process.env.TONGYI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },

  retrieval: {
    topK: parseInt(process.env.RETRIEVAL_TOP_K || '5', 10),
  },

  jwtSecret: process.env.JWT_SECRET || 'geo-knowledge-demo-secret-key',
}
