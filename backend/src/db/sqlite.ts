import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RuntimeSettings, RuntimeSettingsRepository } from '../services/runtime-settings.js'
import { getSyntheticDemoRepository, syntheticDemoEnabled } from '../services/synthetic-demo.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 生产数据库（Python 预处理管线产物） */
const DB_PATH = syntheticDemoEnabled()
  ? path.resolve(__dirname, '../../data/synthetic-demo.db')
  : path.resolve(__dirname, '../../../ml-service/output/geo_knowledge.db')

let _db: Database.Database | null = null

function getDb(): Database.Database {
  if (!_db) {
    mkdirSync(path.dirname(DB_PATH), { recursive: true })
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    initQaLogs(_db)
    initRuntimeSettings(_db)
  }
  return _db
}

function initQaLogs(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS qa_logs (
      id        TEXT PRIMARY KEY,
      question  TEXT NOT NULL,
      path_used TEXT NOT NULL DEFAULT '[]',
      hit_docs  INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      satisfaction TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `)
  // 兼容旧表：补充新列
  for (const col of [
    'ALTER TABLE qa_logs ADD COLUMN kg_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE qa_logs ADD COLUMN spatial_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE qa_logs ADD COLUMN rag_mode TEXT',
    'ALTER TABLE qa_logs ADD COLUMN rag_weight REAL NOT NULL DEFAULT 0',
    'ALTER TABLE qa_logs ADD COLUMN kg_weight REAL NOT NULL DEFAULT 0',
    'ALTER TABLE qa_logs ADD COLUMN spatial_weight REAL NOT NULL DEFAULT 0',
  ]) {
    try { db.exec(col) } catch { /* 列已存在 */ }
  }
}

function initRuntimeSettings(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_settings (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      rag_enabled     INTEGER NOT NULL,
      rag_mode        TEXT NOT NULL CHECK (rag_mode IN ('bge', 'tfidf')),
      rag_weight      REAL NOT NULL,
      rag_top_k       INTEGER NOT NULL,
      kg_enabled      INTEGER NOT NULL,
      kg_weight       REAL NOT NULL,
      spatial_enabled INTEGER NOT NULL,
      spatial_weight  REAL NOT NULL,
      llm_model       TEXT NOT NULL,
      max_tokens      INTEGER NOT NULL,
      temperature     REAL NOT NULL,
      updated_at      TEXT,
      updated_by      TEXT
    )
  `)
}

export function createRuntimeSettingsRepository(db: Database.Database): RuntimeSettingsRepository {
  initRuntimeSettings(db)
  return {
    load(): RuntimeSettings | null {
      const row = db.prepare(`
        SELECT rag_enabled AS ragEnabled, rag_mode AS ragMode,
               rag_weight AS ragWeight, rag_top_k AS ragTopK,
               kg_enabled AS kgEnabled, kg_weight AS kgWeight,
               spatial_enabled AS spatialEnabled, spatial_weight AS spatialWeight,
               llm_model AS llmModel, max_tokens AS maxTokens,
               temperature, updated_at AS updatedAt, updated_by AS updatedBy
        FROM runtime_settings WHERE id = 1
      `).get() as Record<string, unknown> | undefined
      if (!row) return null
      return {
        ragEnabled: Boolean(row.ragEnabled),
        ragMode: row.ragMode as RuntimeSettings['ragMode'],
        ragWeight: Number(row.ragWeight),
        ragTopK: Number(row.ragTopK),
        kgEnabled: Boolean(row.kgEnabled),
        kgWeight: Number(row.kgWeight),
        spatialEnabled: Boolean(row.spatialEnabled),
        spatialWeight: Number(row.spatialWeight),
        llmModel: String(row.llmModel),
        maxTokens: Number(row.maxTokens),
        temperature: Number(row.temperature),
        updatedAt: row.updatedAt == null ? null : String(row.updatedAt),
        updatedBy: row.updatedBy == null ? null : String(row.updatedBy),
      }
    },
    save(settings: RuntimeSettings): void {
      const write = db.transaction((value: RuntimeSettings) => {
        db.prepare(`
          INSERT INTO runtime_settings (
            id, rag_enabled, rag_mode, rag_weight, rag_top_k,
            kg_enabled, kg_weight, spatial_enabled, spatial_weight,
            llm_model, max_tokens, temperature, updated_at, updated_by
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            rag_enabled = excluded.rag_enabled,
            rag_mode = excluded.rag_mode,
            rag_weight = excluded.rag_weight,
            rag_top_k = excluded.rag_top_k,
            kg_enabled = excluded.kg_enabled,
            kg_weight = excluded.kg_weight,
            spatial_enabled = excluded.spatial_enabled,
            spatial_weight = excluded.spatial_weight,
            llm_model = excluded.llm_model,
            max_tokens = excluded.max_tokens,
            temperature = excluded.temperature,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        `).run(
          value.ragEnabled ? 1 : 0,
          value.ragMode,
          value.ragWeight,
          value.ragTopK,
          value.kgEnabled ? 1 : 0,
          value.kgWeight,
          value.spatialEnabled ? 1 : 0,
          value.spatialWeight,
          value.llmModel,
          value.maxTokens,
          value.temperature,
          value.updatedAt,
          value.updatedBy,
        )
      })
      write(settings)
    },
  }
}

export function getRuntimeSettingsRepository(): RuntimeSettingsRepository {
  return createRuntimeSettingsRepository(getDb())
}

/** 安全检查：表是否存在（C 跑管线前 documents/chunks 可能不存在） */
function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name)
  return !!row
}

// ── 文档 ──

export interface DocRow {
  docId: number
  title: string
  docType: string
  totalPages: number
  chunkCount: number
  status: string
  uploadedAt: string
}

export function getDocs(): DocRow[] {
  if (syntheticDemoEnabled()) return getSyntheticDemoRepository().listDocuments()
  try {
    const db = getDb()
    if (!tableExists(db, 'documents')) return []
    return db.prepare(
      `SELECT d.id AS docId, d.title, d.doc_type AS docType,
              d.total_pages AS totalPages, d.created_at AS uploadedAt,
              COUNT(c.id) AS chunkCount
       FROM documents d LEFT JOIN chunks c ON c.doc_id = d.id
       GROUP BY d.id ORDER BY d.id`
    ).all() as DocRow[]
  } catch (err) {
    console.warn('[sqlite] getDocs 失败:', (err as Error).message)
    return []
  }
}

export function deleteDoc(id: number): boolean {
  if (syntheticDemoEnabled()) return false
  try {
    const db = getDb()
    if (!tableExists(db, 'documents')) return false
    const remove = db.transaction((docId: number) => {
      const existing = db.prepare('SELECT 1 FROM documents WHERE id = ?').get(docId)
      if (!existing) return false

      if (tableExists(db, 'chunks')) {
        db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(docId)
      }
      return db.prepare('DELETE FROM documents WHERE id = ?').run(docId).changes === 1
    })
    if (!remove(id)) return false
    console.log(`[sqlite] 已删除文档 id=${id}`)
    return true
  } catch (err) {
    console.warn('[sqlite] deleteDoc 失败:', (err as Error).message)
    return false
  }
}

export function getDocById(id: number): DocRow | undefined {
  if (syntheticDemoEnabled()) return getSyntheticDemoRepository().getDocument(id)
  try {
    const db = getDb()
    if (!tableExists(db, 'documents')) return undefined
    return db.prepare(
      `SELECT d.id AS docId, d.title, d.doc_type AS docType,
              d.total_pages AS totalPages, d.created_at AS uploadedAt,
              COUNT(c.id) AS chunkCount
       FROM documents d LEFT JOIN chunks c ON c.doc_id = d.id
       WHERE d.id = ? GROUP BY d.id`
    ).get(id) as DocRow | undefined
  } catch (err) {
    console.warn('[sqlite] getDocById 失败:', (err as Error).message)
    return undefined
  }
}

export function getChunksByDocId(docId: number) {
  if (syntheticDemoEnabled()) return getSyntheticDemoRepository().getDocumentChunks(docId)
  try {
    const db = getDb()
    if (!tableExists(db, 'chunks')) return []
    return db.prepare(
      `SELECT id, page, chunk_index AS chunkIndex, text,
              char_start AS charStart, char_end AS charEnd
       FROM chunks WHERE doc_id = ? ORDER BY page, chunk_index`
    ).all(docId)
  } catch (err) {
    console.warn('[sqlite] getChunksByDocId 失败:', (err as Error).message)
    return []
  }
}

// ── 问答日志 ──

export interface QaLogRow {
  id: string
  question: string
  pathUsed: string[]
  hitDocs: number
  kgCount: number
  spatialCount: number
  ragMode: string | null
  ragWeight: number
  kgWeight: number
  spatialWeight: number
  latency: number
  satisfaction: string | null
  createdAt: string
}

export function insertQaLog(log: {
  id: string; question: string; pathUsed: string[]; hitDocs: number; kgCount: number; spatialCount: number; latency: number
  ragMode: string; ragWeight: number; kgWeight: number; spatialWeight: number
}): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO qa_logs (
       id, question, path_used, hit_docs, kg_count, spatial_count, latency_ms,
       rag_mode, rag_weight, kg_weight, spatial_weight
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    log.id, log.question, JSON.stringify(log.pathUsed), log.hitDocs,
    log.kgCount, log.spatialCount, log.latency, log.ragMode,
    log.ragWeight, log.kgWeight, log.spatialWeight,
  )
}

export function getQaLogs(): QaLogRow[] {
  const db = getDb()
  const rows = db.prepare(
    `SELECT id, question, path_used AS pathUsedRaw, hit_docs AS hitDocs,
            kg_count AS kgCount, spatial_count AS spatialCount,
            rag_mode AS ragMode, rag_weight AS ragWeight,
            kg_weight AS kgWeight, spatial_weight AS spatialWeight,
            latency_ms AS latency, satisfaction, created_at AS createdAt
     FROM qa_logs ORDER BY created_at DESC LIMIT 100`
  ).all() as any[]
  return rows.map((r: any) => ({
    id: r.id, question: r.question,
    pathUsed: JSON.parse(r.pathUsedRaw || '[]'),
    hitDocs: r.hitDocs, kgCount: r.kgCount || 0, spatialCount: r.spatialCount || 0,
    ragMode: r.ragMode || null,
    ragWeight: r.ragWeight || 0, kgWeight: r.kgWeight || 0, spatialWeight: r.spatialWeight || 0,
    latency: r.latency, satisfaction: r.satisfaction, createdAt: r.createdAt,
  }))
}

// ── 统计 ──

export function getStats() {
  if (syntheticDemoEnabled()) {
    const snapshot = getSyntheticDemoRepository().snapshot()
    const db = getDb()
    const logCount = tableExists(db, 'qa_logs')
      ? (db.prepare('SELECT COUNT(*) AS n FROM qa_logs').get() as { n: number }).n
      : 0
    return { docCount: snapshot.documentCount, chunkCount: snapshot.chunkCount, logCount }
  }
  const db = getDb()
  const docCount = tableExists(db, 'documents')
    ? (db.prepare('SELECT COUNT(*) AS n FROM documents').get() as any).n : 0
  const chunkCount = tableExists(db, 'chunks')
    ? (db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as any).n : 0
  const logCount = tableExists(db, 'qa_logs')
    ? (db.prepare('SELECT COUNT(*) AS n FROM qa_logs').get() as any).n : 0
  return { docCount, chunkCount, logCount }
}
