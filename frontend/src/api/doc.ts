import type { Document } from '@/types'
import request from './request'

/** 获取文档列表 */
export async function getDocList(): Promise<Document[]> {
  return request.get('/admin/docs')
}

/** 上传 PDF 文档 */
export async function uploadDoc(form: FormData): Promise<{
  docId: number
  filename: string
  size: number
  path: string
  uploadedAt: string
  message: string
}> {
  return request.post('/admin/docs/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,  // 大文件上传允许 60s
  })
}
