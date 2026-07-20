import { Router, type Request, type Response } from 'express'
import { getDocs, getDocById, getChunksByDocId, getQaLogs, getStats, deleteDoc } from '../db/sqlite.js'
import { getEntityStats, deleteEntity, getEntityDetail, updateEntity } from '../services/kg.js'
import { updateRuntimeSettings, type RuntimeSettingsInput } from '../services/runtime-settings.js'
import { getRetrievalConfigStatus } from '../services/retrieval-status.js'
import { adminMiddleware, type JwtPayload } from '../middleware/auth.js'

const router = Router()

// 该路由下所有接口仅管理员可访问
router.use('/admin', adminMiddleware)

/**
 * GET /api/admin/stats
 */
router.get('/admin/stats', async (_req: Request, res: Response) => {
  try {
    const sqliteStats = getStats()
    const kgStats = await getEntityStats()
    res.json({
      docCount: sqliteStats.docCount,
      chunkCount: sqliteStats.chunkCount,
      entityCount: kgStats.totalNodes,
      qaCount: sqliteStats.logCount,
    })
  } catch (err) {
    console.error('[admin] stats 失败:', err)
    res.status(500).json({ error: '服务内部错误' })
  }
})

/**
 * GET /api/admin/docs
 */
router.get('/admin/docs', (_req: Request, res: Response) => {
  try {
    const docs = getDocs()
    res.json(docs.map((d) => ({
      docId: d.docId, title: d.title, docType: d.docType,
      domain: d.docType || '地质',
      status: d.chunkCount > 0 ? 'completed' as const : 'processing' as const,
      chunkCount: d.chunkCount, uploadedAt: d.uploadedAt,
    })))
  } catch (err) {
    console.error('[admin] docs 失败:', err)
    res.status(500).json({ error: '服务内部错误' })
  }
})

/**
 * GET /api/admin/docs/:id
 */
router.get('/admin/docs/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    const doc = getDocById(id)
    if (!doc) { res.status(404).json({ error: '文档不存在' }); return }
    res.json({ ...doc, chunks: getChunksByDocId(id) })
  } catch (err) {
    console.error('[admin] doc detail 失败:', err)
    res.status(500).json({ error: '服务内部错误' })
  }
})

/**
 * GET /api/admin/entities
 */
router.get('/admin/entities', async (_req: Request, res: Response) => {
  try {
    const entities = await getEntityStats()
    res.json(entities.list ?? [])
  } catch (err) {
    console.error('[admin] entities 失败:', err)
    res.status(500).json({ error: '服务内部错误' })
  }
})

/**
 * GET /api/admin/retrieval-config
 */
router.get('/admin/retrieval-config', async (_req: Request, res: Response) => {
  try {
    res.json(await getRetrievalConfigStatus())
  } catch (err) {
    console.error('[admin] config 失败:', err)
    res.status(500).json({ error: '服务内部错误' })
  }
})

/**
 * PUT /api/admin/retrieval-config
 * Updates settings that take effect for subsequent Q&A requests. They are reset
 * on a backend restart; deployment defaults remain environment variables.
 */
router.put('/admin/retrieval-config', async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<RuntimeSettingsInput>
    const user = (req as Request & { user?: JwtPayload }).user
    const next = updateRuntimeSettings(body, user?.username || 'admin')
    res.json({
      ...(await getRetrievalConfigStatus(next)),
      message: '检索策略已保存，并已在当前问答进程加载',
    })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

/**
 * GET /api/admin/qa-logs
 */
router.get('/admin/qa-logs', (_req: Request, res: Response) => {
  try {
    res.json(getQaLogs())
  } catch (err) {
    console.error('[admin] logs 失败:', err)
    res.status(500).json({ error: '服务内部错误' })
  }
})

/**
 * GET /api/admin/entities/:id
 */
router.get('/admin/entities/:id', async (req: Request, res: Response) => {
  try {
    const entityId = req.params.id.trim()
    if (!entityId) { res.status(400).json({ error: '无效的实体 ID' }); return }
    const entity = await getEntityDetail(entityId)
    if (!entity) { res.status(404).json({ error: '实体不存在' }); return }
    res.json(entity)
  } catch (err) {
    console.error('[admin] entity detail 失败:', err)
    res.status(500).json({ error: '服务内部错误' })
  }
})

/**
 * PUT /api/admin/entities/:id
 */
router.put('/admin/entities/:id', async (req: Request, res: Response) => {
  try {
    const entityId = req.params.id.trim()
    if (!entityId) { res.status(400).json({ error: '无效的实体 ID' }); return }
    const { name, description, status } = req.body || {}
    if (status !== undefined && !['verified', 'pending'].includes(status)) {
      res.status(400).json({ error: '状态只能是已审核或待审核' }); return
    }
    const props: Record<string, unknown> = {}
    if (name !== undefined) props.name = name
    if (description !== undefined) props.description = description
    if (status !== undefined) props.status = status
    if (Object.keys(props).length === 0) {
      res.status(400).json({ error: '没有要更新的字段' }); return
    }
    const ok = await updateEntity(entityId, props)
    if (!ok) { res.status(404).json({ error: '实体不存在' }); return }
    const entity = await getEntityDetail(entityId)
    res.json({ success: true, entity })
  } catch (err) {
    console.error('[admin] update entity 失败:', err)
    res.status(500).json({ error: '服务内部错误' })
  }
})

/**
 * DELETE /api/admin/docs/:id
 */
router.delete('/admin/docs/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) { res.status(400).json({ error: '无效的文档 ID' }); return }
    const ok = deleteDoc(id)
    if (!ok) { res.status(404).json({ error: '文档不存在' }); return }

    let retrievalIndexReloaded = false
    try {
      const reloadResponse = await fetch('http://127.0.0.1:5000/reload-index', { method: 'POST' })
      retrievalIndexReloaded = reloadResponse.ok
      if (!reloadResponse.ok) {
        console.warn(`[admin] Flask 索引刷新失败: HTTP ${reloadResponse.status}`)
      }
    } catch (err) {
      console.warn('[admin] Flask 未运行，检索索引将在下次启动时刷新:', (err as Error).message)
    }

    res.json({ success: true, retrievalIndexReloaded })
  } catch (err) {
    console.error('[admin] delete doc 失败:', err)
    res.status(500).json({ error: '服务内部错误' })
  }
})

/**
 * DELETE /api/admin/entities/:id
 */
router.delete('/admin/entities/:id', async (req: Request, res: Response) => {
  try {
    const entityId = req.params.id.trim()
    if (!entityId) { res.status(400).json({ error: '无效的实体 ID' }); return }
    const ok = await deleteEntity(entityId)
    if (!ok) { res.status(404).json({ error: '实体不存在' }); return }
    res.json({ success: true })
  } catch (err) {
    console.error('[admin] delete entity 失败:', err)
    res.status(500).json({ error: '服务内部错误' })
  }
})

export default router
