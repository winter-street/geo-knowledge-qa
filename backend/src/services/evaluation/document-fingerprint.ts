import { createHash } from 'node:crypto'
import { getChunksByDocId } from '../../db/sqlite.js'

export interface FingerprintChunk {
  page: number
  chunkIndex: number
  text: string
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
}

export function canonicalDocumentFingerprint(chunks: FingerprintChunk[]): string {
  const canonical = [...chunks]
    .sort((left, right) => left.page - right.page || left.chunkIndex - right.chunkIndex)
    .map((chunk) => `${chunk.page}:${chunk.chunkIndex}:${normalizeText(chunk.text)}`)
    .join('\n')
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

export function fingerprintDocumentId(documentId: number): string | undefined {
  const chunks = getChunksByDocId(documentId) as FingerprintChunk[]
  return chunks.length > 0 ? canonicalDocumentFingerprint(chunks) : undefined
}
