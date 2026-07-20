import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createRuntimeSettingsRepository } from '../db/sqlite.js'
import {
  createRuntimeSettingsManager,
  type RuntimeSettings,
} from './runtime-settings.js'

const defaults: RuntimeSettings = {
  ragEnabled: true,
  ragMode: 'bge',
  ragWeight: 0.35,
  ragTopK: 5,
  kgEnabled: true,
  kgWeight: 0.4,
  spatialEnabled: true,
  spatialWeight: 0.25,
  llmModel: 'deepseek-chat',
  maxTokens: 2048,
  temperature: 0.3,
  updatedAt: null,
  updatedBy: null,
}

const db = new Database(':memory:')
const repository = createRuntimeSettingsRepository(db)
const manager = createRuntimeSettingsManager(repository, defaults)

assert.deepEqual(manager.get(), defaults, 'empty database should use configured defaults')

const saved = manager.update({
  ragEnabled: false,
  ragMode: 'tfidf',
  ragWeight: 0.2,
  ragTopK: 8,
  kgEnabled: true,
  kgWeight: 0.6,
  spatialEnabled: false,
  spatialWeight: 0,
  llmModel: 'deepseek-v4-flash',
  maxTokens: 3072,
  temperature: 0.2,
}, 'admin')

assert.equal(saved.updatedBy, 'admin')
assert.ok(saved.updatedAt)
assert.deepEqual(
  createRuntimeSettingsManager(repository, defaults).get(),
  saved,
  'saved settings should be restored by a new manager instance',
)

const beforeInvalidUpdate = manager.get()
assert.throws(
  () => manager.update({ ragWeight: 1.2 }, 'admin'),
  /RAG 权重必须在 0 到 1 之间/,
)
assert.deepEqual(manager.get(), beforeInvalidUpdate, 'invalid input must not change memory state')
assert.deepEqual(repository.load(), beforeInvalidUpdate, 'invalid input must not change SQLite state')

assert.throws(() => manager.update({ ragMode: 'bm25' as 'bge' }, 'admin'), /RAG 模式/)
assert.throws(() => manager.update({ ragTopK: 0 }, 'admin'), /Top-K/)
assert.throws(() => manager.update({ maxTokens: 8193 }, 'admin'), /最大 Token/)
assert.throws(() => manager.update({ temperature: -0.1 }, 'admin'), /Temperature/)

db.close()
console.log('[PASS] runtime settings: defaults, validation and SQLite persistence')
