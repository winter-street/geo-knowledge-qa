import { Router, type Request, type Response } from 'express'
import { getSubgraph } from '../services/kg.js'
import { resolveSpatialData } from '../services/spatial.js'

const router = Router()

/**
 * GET /api/kg/subgraph?keyword=xxx
 *
 * 返回知识图谱子图数据（节点 + 边），供前端 GraphView 使用
 */
router.get('/kg/subgraph', async (req: Request, res: Response) => {
  try {
    const keyword = (req.query.keyword as string) || ''

    if (!keyword.trim()) {
      res.status(400).json({ error: 'keyword 参数不能为空' })
      return
    }

    const depth = parseInt((req.query.depth as string) || '2', 10)

    const subgraph = await getSubgraph(keyword.trim(), undefined, depth)

    res.json(subgraph)
  } catch (err) {
    console.error('[kg-route] 子图查询失败:', err)
    res.status(500).json({ error: '服务内部错误' })
  }
})

/**
 * GET /api/kg/spatial?keyword=xxx
 *
 * 空间坐标查询。优先返回 Neo4j 实体坐标；仅当关键词命中演示主题时回退 mock 数据。
 */
router.get('/kg/spatial', async (req: Request, res: Response) => {
  const keyword = (req.query.keyword as string | undefined)?.trim() || ''
  if (!keyword) {
    res.status(400).json({ error: 'keyword 参数不能为空' })
    return
  }

  try {
    const result = await resolveSpatialData(keyword)
    res.json({ ...result.data, source: result.source })
  } catch (err) {
    console.error('[kg-route] 空间查询失败:', err)
    res.status(500).json({ error: '服务内部错误' })
  }
})

export default router
