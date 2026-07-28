import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AgentConversation,
  AgentMemory,
  AgentMessage,
  AgentRun,
  AgentRunStatus,
  AgentToolCall,
  LinkedEntity,
} from '../types/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DB_PATH = path.resolve(__dirname, '../../data/app.db')

export interface AppStateStore {
  createConversation(userId: string, id: string, title: string, createdAt?: string): void
  getConversation(userId: string, id: string): AgentConversation | undefined
  appendMessage(userId: string, conversationId: string, message: AgentMessage): void
  getRecentMessages(userId: string, conversationId: string, turns: number): AgentMessage[]
  saveMemory(userId: string, conversationId: string, summary: string, activeEntities: LinkedEntity[]): void
  loadMemory(userId: string, conversationId: string): AgentMemory
  createAgentRun(run: AgentRun): void
  finishAgentRun(userId: string, runId: string, status: AgentRunStatus, latencyMs: number, finishedAt?: string): void
  recordToolCall(call: AgentToolCall): void
  getToolCalls(userId: string, runId: string): AgentToolCall[]
}

function initAppState(db: Database.Database): void {
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id)
    );
    CREATE TABLE IF NOT EXISTS agent_memory (
      conversation_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      active_entities_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id)
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      intent TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      finished_at TEXT,
      latency_ms INTEGER,
      FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id)
    );
    CREATE TABLE IF NOT EXISTS agent_tool_calls (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      argument_summary_json TEXT NOT NULL,
      status TEXT NOT NULL,
      latency_ms INTEGER,
      evidence_count INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_user_conversation
      ON agent_messages(user_id, conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_user_conversation
      ON agent_runs(user_id, conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_user_run
      ON agent_tool_calls(user_id, run_id, created_at);
  `)
}

function assertConversationOwner(db: Database.Database, userId: string, conversationId: string): void {
  const row = db.prepare(
    'SELECT 1 FROM agent_conversations WHERE id = ? AND user_id = ?',
  ).get(conversationId, userId)
  if (!row) throw new Error('Conversation not found for user')
}

function assertRunOwner(db: Database.Database, userId: string, runId: string): void {
  const row = db.prepare('SELECT 1 FROM agent_runs WHERE id = ? AND user_id = ?').get(runId, userId)
  if (!row) throw new Error('Agent run not found for user')
}

function sanitizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, seen))
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return undefined
  seen.add(value)

  const sanitized: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '')
    if (/chainofthought|thought|reasoning|prompt|scratchpad|rationale|analysis/.test(normalizedKey)) continue
    sanitized[key] = sanitizeValue(nestedValue, seen)
  }
  return sanitized
}

export function sanitizeToolArguments(argumentsSummary: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(argumentsSummary) as Record<string, unknown>
}

export function createAppStateStore(db: Database.Database): AppStateStore {
  initAppState(db)
  return {
    createConversation(userId, id, title, createdAt = new Date().toISOString()): void {
      db.prepare(
        'INSERT INTO agent_conversations (id, user_id, title, created_at) VALUES (?, ?, ?, ?)',
      ).run(id, userId, title, createdAt)
    },
    getConversation(userId, id): AgentConversation | undefined {
      return db.prepare(`
        SELECT id, user_id AS userId, title, created_at AS createdAt
        FROM agent_conversations WHERE id = ? AND user_id = ?
      `).get(id, userId) as AgentConversation | undefined
    },
    appendMessage(userId, conversationId, message): void {
      assertConversationOwner(db, userId, conversationId)
      db.prepare(`
        INSERT INTO agent_messages (id, conversation_id, user_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(message.id, conversationId, userId, message.role, message.content, message.createdAt)
    },
    getRecentMessages(userId, conversationId, turns): AgentMessage[] {
      const limit = Math.max(0, Math.floor(turns) * 2)
      if (limit === 0) return []
      const rows = db.prepare(`
        SELECT id, role, content, created_at AS createdAt
        FROM agent_messages
        WHERE conversation_id = ? AND user_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ?
      `).all(conversationId, userId, limit) as AgentMessage[]
      return rows.reverse()
    },
    saveMemory(userId, conversationId, summary, activeEntities): void {
      assertConversationOwner(db, userId, conversationId)
      db.prepare(`
        INSERT INTO agent_memory (conversation_id, user_id, summary, active_entities_json, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET
          user_id = excluded.user_id,
          summary = excluded.summary,
          active_entities_json = excluded.active_entities_json,
          updated_at = excluded.updated_at
      `).run(conversationId, userId, summary, JSON.stringify(activeEntities), new Date().toISOString())
    },
    loadMemory(userId, conversationId): AgentMemory {
      const row = db.prepare(`
        SELECT summary, active_entities_json AS activeEntitiesJson
        FROM agent_memory WHERE conversation_id = ? AND user_id = ?
      `).get(conversationId, userId) as { summary: string; activeEntitiesJson: string } | undefined
      return {
        recentMessages: this.getRecentMessages(userId, conversationId, 6),
        summary: row?.summary ?? '',
        activeEntities: row ? JSON.parse(row.activeEntitiesJson) as LinkedEntity[] : [],
      }
    },
    createAgentRun(run): void {
      assertConversationOwner(db, run.userId, run.conversationId)
      db.prepare(`
        INSERT INTO agent_runs (
          id, user_id, conversation_id, intent, status, created_at, finished_at, latency_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        run.id, run.userId, run.conversationId, run.intent, run.status, run.createdAt,
        run.finishedAt ?? null, run.latencyMs ?? null,
      )
    },
    finishAgentRun(userId, runId, status, latencyMs, finishedAt = new Date().toISOString()): void {
      assertRunOwner(db, userId, runId)
      db.prepare(`
        UPDATE agent_runs SET status = ?, latency_ms = ?, finished_at = ?
        WHERE id = ? AND user_id = ?
      `).run(status, latencyMs, finishedAt, runId, userId)
    },
    recordToolCall(call): void {
      assertRunOwner(db, call.userId, call.runId)
      db.prepare(`
        INSERT INTO agent_tool_calls (
          id, run_id, user_id, tool_name, argument_summary_json,
          status, latency_ms, evidence_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        call.id, call.runId, call.userId, call.toolName,
        JSON.stringify(sanitizeToolArguments(call.argumentSummary)),
        call.status, call.latencyMs ?? null, call.evidenceCount ?? null, call.createdAt,
      )
    },
    getToolCalls(userId, runId): AgentToolCall[] {
      const rows = db.prepare(`
        SELECT t.id, t.run_id AS runId, t.user_id AS userId, t.tool_name AS toolName,
               t.argument_summary_json AS argumentSummaryJson, t.status,
               t.latency_ms AS latencyMs, t.evidence_count AS evidenceCount,
               t.created_at AS createdAt
        FROM agent_tool_calls t
        JOIN agent_runs r ON r.id = t.run_id AND r.user_id = t.user_id
        WHERE t.run_id = ? AND t.user_id = ?
        ORDER BY t.created_at, t.id
      `).all(runId, userId) as Array<Omit<AgentToolCall, 'argumentSummary'> & { argumentSummaryJson: string }>
      return rows.map(({ argumentSummaryJson, ...row }) => ({
        ...row,
        argumentSummary: JSON.parse(argumentSummaryJson) as Record<string, unknown>,
      }))
    },
  }
}

let appStateStore: AppStateStore | null = null

export function getAppStateStore(): AppStateStore {
  if (!appStateStore) {
    mkdirSync(path.dirname(APP_DB_PATH), { recursive: true })
    appStateStore = createAppStateStore(new Database(APP_DB_PATH))
  }
  return appStateStore
}
