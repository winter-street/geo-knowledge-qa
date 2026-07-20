import request from './request'
import type {
  RetrievalConfigResponse,
  RuntimeRetrievalSettingsPayload,
} from '@/types'
import { parseRetrievalConfigResponse } from '@/utils/retrieval-config'

export async function getRetrievalConfig(): Promise<RetrievalConfigResponse> {
  return parseRetrievalConfigResponse(await request.get('/admin/retrieval-config'))
}

export async function saveRetrievalConfig(
  settings: RuntimeRetrievalSettingsPayload,
): Promise<RetrievalConfigResponse> {
  return parseRetrievalConfigResponse(await request.put('/admin/retrieval-config', settings))
}
