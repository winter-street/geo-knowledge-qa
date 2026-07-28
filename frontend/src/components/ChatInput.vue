<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { AgentMode, RetrievalMode } from '@/types'

const props = defineProps<{
  loading?: boolean
  retrievalMode: RetrievalMode
  agentMode: AgentMode
}>()

const emit = defineEmits<{
  send: [text: string]
  'update:retrievalMode': [mode: RetrievalMode]
  'update:agentMode': [mode: AgentMode]
}>()

const MODE_OPTIONS: { value: RetrievalMode; label: string }[] = [
  { value: 'rag', label: 'RAG检索' },
  { value: 'kg', label: '知识图谱' },
  { value: 'hybrid', label: '混合检索' },
]

const AGENT_OPTIONS: { value: AgentMode; label: string }[] = [
  { value: 'agent', label: 'Agent' },
  { value: 'direct', label: '直接问答' },
]

const text = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)

function resizeTextarea() {
  const el = textarea.value
  if (!el) return
  el.style.height = '44px'
  el.style.height = `${Math.min(160, el.scrollHeight)}px`
}

function handleSend() {
  const trimmed = text.value.trim()
  if (!trimmed) return
  emit('send', trimmed)
  text.value = ''
  nextTick(resizeTextarea)
}

function selectMode(mode: RetrievalMode) {
  emit('update:retrievalMode', mode)
}

function selectAgentMode(mode: AgentMode) {
  emit('update:agentMode', mode)
}

function handleKeydown(event: KeyboardEvent) {
  // 关键修复：中文/日文等输入法「组合输入」期间，回车只是选词 / 上屏，绝不能触发发送。
  // isComposing 覆盖现代浏览器；keyCode === 229 兜底部分输入法在组合期上报的按键。
  // 少了这一步，用拼音打字时按回车选词会把半截未上屏的内容直接发出去。
  if (event.isComposing || event.keyCode === 229) return

  // Ctrl / Cmd + Enter：快速发送
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    handleSend()
    return
  }

  // Shift + Enter：换行。交给 textarea 原生行为插入换行即可，
  // watch(text) 会自动重算高度，无需再手动拼接字符串 / 设置光标。
  if (event.key === 'Enter' && event.shiftKey) {
    return
  }

  // 单独 Enter：发送
  if (event.key === 'Enter') {
    event.preventDefault()
    handleSend()
  }
}

watch(text, resizeTextarea)
</script>

<template>
  <div class="input-area">
    <div class="input-row">
      <textarea
        ref="textarea"
        v-model="text"
        placeholder="输入你的问题..."
        @keydown="handleKeydown"
      />
      <button class="send-btn" :disabled="loading" @click="handleSend">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
        {{ loading ? '生成中' : '发送' }}
      </button>
    </div>
    <div class="mode-bar">
      <div class="agent-toggle" role="group" aria-label="问答方式">
        <button
          v-for="mode in AGENT_OPTIONS"
          :key="mode.value"
          class="mode-btn"
          :class="{ active: agentMode === mode.value }"
          :disabled="loading"
          @click="selectAgentMode(mode.value)"
        >{{ mode.label }}</button>
      </div>
      <button
        v-for="m in MODE_OPTIONS"
        :key="m.value"
        class="mode-btn"
        :class="{ active: retrievalMode === m.value }"
        :disabled="loading"
        @click="selectMode(m.value)"
      >{{ m.label }}</button>
      <span class="hint">Enter 发送 · Shift+Enter 换行</span>
    </div>
  </div>
</template>

<style scoped>
.input-area {
  padding: 20px 32px;
  border-top: 1px solid var(--color-ink-100);
  background: var(--color-bg);
}

.input-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

textarea {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--color-ink-100);
  border-radius: var(--radius-md);
  font-size: 14px;
  resize: none;
  min-height: 44px;
  max-height: 160px;
  background: var(--color-bg-subtle);
  font-family: var(--font-body);
  color: var(--color-ink-900);
  line-height: 1.5;
  outline: none;
  transition: all 0.2s;
}

textarea:focus {
  border-color: var(--color-primary);
  background: var(--color-surface);
}

textarea::placeholder {
  color: var(--color-ink-300);
}

.send-btn {
  padding: 0 20px;
  height: 44px;
  background: var(--color-ink-900);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: var(--font-body);
  letter-spacing: 0.06em;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background 0.2s;
}

.send-btn:hover:not(:disabled) {
  background: var(--color-ink-700);
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.send-btn svg {
  width: 14px;
  height: 14px;
}

.mode-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
}

.agent-toggle {
  display: flex;
  margin-right: 8px;
}

.agent-toggle .mode-btn {
  border-radius: 0;
}

.agent-toggle .mode-btn + .mode-btn {
  margin-left: -1px;
}

.agent-toggle .mode-btn:first-child {
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.agent-toggle .mode-btn:last-child {
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.mode-btn {
  padding: 2px 10px;
  height: 24px;
  border: 1px solid var(--color-ink-100);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  color: var(--color-ink-500);
  font-size: 11px;
  font-family: var(--font-body);
  font-weight: 500;
  cursor: pointer;
  letter-spacing: 0.04em;
  transition: all 0.2s;
}

.mode-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.mode-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

.mode-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hint {
  margin-left: auto;
  font-size: 10px;
  color: var(--color-ink-300);
  letter-spacing: 0.04em;
}

@media (max-width: 760px) {
  .input-area { padding: 12px; }
  .input-row { gap: 8px; }

  .send-btn {
    width: 44px;
    flex: 0 0 44px;
    padding: 0;
    justify-content: center;
    gap: 0;
    font-size: 0;
  }

  .send-btn svg { width: 16px; height: 16px; }

  .mode-bar {
    flex-wrap: wrap;
    row-gap: 6px;
  }

  .agent-toggle { margin-right: 4px; }
  .mode-btn { padding: 2px 8px; }
  .hint { display: none; }
}
</style>
