/**
 * PDF 上传路由
 *
 * POST /api/admin/docs/upload
 *   Content-Type: multipart/form-data
 *   字段: file (PDF 文件)
 *   返回: { docId, filename, size, path, uploadedAt }
 *
 * 上传后文件存储在 backend/uploads/，
 * 自动触发预处理管线: python scripts/run_pipeline.py --file backend/uploads/xxx.pdf
 */

import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { adminMiddleware } from '../middleware/auth.js'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = path.resolve(__dirname, '..', '..', 'uploads')

// 确保上传目录存在
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR)
  },
  filename: (_req, file, cb) => {
    // 保留原始中文文件名，加时间戳防重名
    const timestamp = Date.now()
    const safeName = `${timestamp}-${Buffer.from(file.originalname, 'latin1').toString('utf8')}`
    cb(null, safeName)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true)
    } else {
      cb(new Error('仅支持 PDF 文件'))
    }
  },
})

const router = Router()

/**
 * POST /api/admin/docs/upload
 */
router.post('/admin/docs/upload', adminMiddleware, upload.single('file'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: '请选择要上传的 PDF 文件' })
      return
    }

    const file = req.file
    const filePath = path.resolve(UPLOADS_DIR, file.filename)

    console.log(`[upload] 文件已接收: ${file.originalname} (${(file.size / 1024).toFixed(1)} KB)`)
    console.log(`[upload] 存储路径: ${filePath}`)
    console.log(`[upload] 启动预处理管线: python scripts/run_pipeline.py --file "${filePath}"`)

    // 异步触发 Python 预处理管线（不阻塞当前响应）
    const pipelineScript = path.resolve(__dirname, '..', '..', '..', 'ml-service', 'scripts', 'run_pipeline.py')
    const child = spawn('python', [pipelineScript, '--file', filePath], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    console.log(`[upload] 管线已在后台启动 (pid: ${child.pid})`)

    res.json({
      docId: Date.now(),
      filename: file.originalname,
      size: file.size,
      path: filePath,
      uploadedAt: new Date().toISOString().slice(0, 10),
      message: '上传成功。请通知 C 同学执行预处理: python scripts/run_pipeline.py --file "' + filePath + '"',
    })
  } catch (err) {
    console.error('[upload] 上传失败:', err)
    res.status(500).json({ error: '上传失败: ' + (err as Error).message })
  }
})

/** multer 错误处理 */
router.use((err: any, _req: Request, res: Response, _next: any) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: '文件过大，最大支持 50MB' })
      return
    }
    res.status(400).json({ error: err.message })
    return
  }
  if (err) {
    res.status(400).json({ error: err.message })
  }
})

export default router
