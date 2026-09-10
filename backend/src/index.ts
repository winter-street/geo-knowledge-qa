import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { initNeo4j } from './services/kg.js'
import { authMiddleware } from './middleware/auth.js'
import qaRouter from './routes/qa.js'
import kgRouter from './routes/kg.js'
import adminRouter from './routes/admin.js'
import authRouter from './routes/auth.js'
import uploadRouter from './routes/upload.js'
import spatialRouter from './routes/spatial.js'
import { getSyntheticDemoRepository, syntheticDemoEnabled } from './services/synthetic-demo.js'

const app = express()

// 中间件
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://192.168.31.169:5173',
  'http://127.0.0.1:5000',
  process.env.FRONTEND_ORIGIN,
].filter((origin): origin is string => Boolean(origin))
app.use(cors({ origin: allowedOrigins, credentials: true }))
app.use(express.json({ limit: '1mb' }))

// 鉴权中间件（/api/auth/login 和 /api/health 为公开路由）
app.use(authMiddleware)

// 路由
app.use('/api', qaRouter)
app.use('/api', kgRouter)
app.use('/api', adminRouter)
app.use('/api', authRouter)
app.use('/api', uploadRouter)
app.use('/api', spatialRouter)

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ...(syntheticDemoEnabled() ? { mode: 'synthetic-demo', synthetic: true, isMock: true } : {}),
  })
})

// 详细健康检查（各依赖状态）
app.get('/api/health/detailed', async (_req, res) => {
  const status: Record<string, any> = { server: 'ok', timestamp: new Date().toISOString() }

  if (syntheticDemoEnabled()) {
    const snapshot = getSyntheticDemoRepository().snapshot()
    res.json({
      ...status,
      mode: 'synthetic-demo',
      synthetic: true,
      isMock: true,
      retrieval: { ok: true, source: 'synthetic', documents: snapshot.documentCount, chunks: snapshot.chunkCount },
      neo4j: { ok: true, source: 'synthetic', nodes: snapshot.entityCount },
      spatial: { ok: true, source: 'synthetic', features: snapshot.spatialFeatureCount },
      llm: { ok: true, source: 'deterministic-fallback' },
    })
    return
  }

  // Neo4j
  try {
    const { getEntityStats } = await import('./services/kg.js')
    const stats = await getEntityStats()
    status.neo4j = { ok: true, nodes: stats.totalNodes }
  } catch (err: any) {
    status.neo4j = { ok: false, error: err.message }
  }

  // Flask
  try {
    const resp = await fetch('http://127.0.0.1:5000/health')
    status.flask = { ok: resp.ok }
  } catch (err: any) {
    status.flask = { ok: false, error: err.message }
  }

  res.json(status)
})

async function bootstrap(): Promise<void> {
  console.log('========================================')
  console.log('  Geo-Knowledge Q&A Backend')
  console.log('  地质找矿知识问答后端服务')
  console.log('========================================')

  // 1. 初始化 Neo4j（地质知识图谱数据）
  initNeo4j()
  console.log('[bootstrap] Neo4j 已初始化，使用地质知识图谱数据')

  // 3. TF-IDF 检索已迁移到 Flask 微服务 (:5000/search)
  //    buildModel() 不再需要
  console.log('[bootstrap] TF-IDF 检索使用 Flask 微服务 (127.0.0.1:5000)')

  // 4. 启动 HTTP 服务
  app.listen(config.port, () => {
    console.log(`[server] 服务已启动: http://localhost:${config.port}`)
    console.log(`[server] 健康检查: http://localhost:${config.port}/api/health`)
    console.log(`[server] Q&A 接口: POST http://localhost:${config.port}/api/qa/ask`)
  })
}

bootstrap().catch((err) => {
  console.error('[bootstrap] 启动失败:', err)
  process.exit(1)
})
