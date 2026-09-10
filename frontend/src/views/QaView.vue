<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useQaStore } from '@/stores/qa'
import { useSpatialTaskStore } from '@/stores/spatial-task'
import ChatMessage from '@/components/ChatMessage.vue'
import ChatInput from '@/components/ChatInput.vue'
import { formatTime } from '@/utils/format'
import { filterConversations } from '@/utils/search'
import { createMessageMapPlan } from '@/utils/map-plan'
import type { Message } from '@/types'

const store = useQaStore()
const spatialTask = useSpatialTaskStore()
const router = useRouter()
const searchQuery = ref('')

// 置顶的排前面
const sortedConversations = computed(() => {
  const list = filterConversations(store.conversations, searchQuery.value)
  return [...list].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
})

// ---- 右键菜单 ----
const ctxMenuVisible = ref(false)
const ctxMenuX = ref(0)
const ctxMenuY = ref(0)
const ctxTargetId = ref<string | null>(null)

function onContextMenu(e: MouseEvent, convId: string) {
  e.preventDefault()
  ctxTargetId.value = convId
  ctxMenuX.value = e.clientX
  ctxMenuY.value = e.clientY
  ctxMenuVisible.value = true
}

function hideContextMenu() {
  ctxMenuVisible.value = false
  ctxTargetId.value = null
}

function handlePin() {
  if (ctxTargetId.value) store.pinConversation(ctxTargetId.value)
  hideContextMenu()
}

function handleDelete() {
  if (ctxTargetId.value && confirm('确定删除这个对话吗？')) {
    store.deleteConversation(ctxTargetId.value)
  }
  hideContextMenu()
}

// ---- 重命名 ----
const renameVisible = ref(false)
const renameText = ref('')

function handleRenameStart() {
  const conv = store.conversations.find((c) => c.id === ctxTargetId.value)
  renameText.value = conv?.title || ''
  renameVisible.value = true
  ctxMenuVisible.value = false  // 只关菜单，保留 ctxTargetId
}

function handleRenameConfirm() {
  if (ctxTargetId.value && renameText.value.trim()) {
    store.renameConversation(ctxTargetId.value, renameText.value.trim())
  }
  renameVisible.value = false
}

// 点击空白处关闭菜单
function onWindowClick() {
  hideContextMenu()
}

onMounted(() => {
  if (store.conversations.length === 0) {
    store.createConversation()
  } else if (!store.currentId) {
    store.selectConversation(store.conversations[0]!.id)
  }
  window.addEventListener('click', onWindowClick)
})

onUnmounted(() => window.removeEventListener('click', onWindowClick))

async function openMessageMap(message: Message, question: string) {
  if (!message.spatialData) return
  const plan = message.mapPlan ?? createMessageMapPlan(message.id, question)
  spatialTask.accept(plan, message.spatialData, message.spatialAnalysis)
  const routeName = localStorage.getItem('role') === 'admin' ? 'AdminMap' : 'UserMap'
  await router.push({ name: routeName, query: { task: plan.id } })
}
</script>

<template>
  <div class="qa-layout">
    <aside class="qa-sidebar">
      <div class="sidebar-head">
        <div class="sys-name">Geo-Knowledge</div>
        <div class="sys-sub">地质找矿 · 智能问答</div>
      </div>
      <div class="search">
        <input v-model="searchQuery" placeholder="搜索对话..." />
      </div>
      <div class="conv-list">
        <div
          v-for="conv in sortedConversations"
          :key="conv.id"
          class="conv-item"
          :class="{ active: store.currentId === conv.id }"
          @click="store.selectConversation(conv.id)"
          @contextmenu="onContextMenu($event, conv.id)"
        >
          <div class="conv-title">
            <span v-if="conv.pinned" class="pin-icon">📌</span>
            {{ conv.title }}
          </div>
          <div class="conv-time">{{ formatTime(conv.createdAt) }}</div>
        </div>
      </div>
      <button class="new-btn" @click="store.createConversation">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
        新建对话
      </button>
    </aside>

    <div class="qa-main">
      <div v-if="store.error" class="error-bar">
        <span>{{ store.error }}</span>
        <button class="error-close" @click="store.clearError()">×</button>
      </div>

      <div class="messages">
        <div v-if="store.currentMessages.length === 0 && !store.loading" class="empty-state">
          <div class="empty-title">Geo-Knowledge 地质找矿智能问答</div>
          <div class="empty-desc">输入问题开始检索知识库 — 支持矿产、岩石、构造、成矿类型等查询</div>
        </div>

        <ChatMessage
          v-for="(msg, idx) in store.currentMessages"
          :key="msg.id"
          :message="msg"
          :question="msg.role === 'assistant' ? store.currentMessages[idx - 1]?.content : undefined"
          :is-last="idx === store.currentMessages.length - 1"
          @open-map="openMessageMap($event, store.currentMessages[idx - 1]?.content || '')"
        />

        <div v-if="store.loading && !store.currentMessages.some(m => m.role === 'assistant' && !m.content)" class="msg assistant">
          <div class="avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div>
          <div class="content">
            <div class="skeleton-line w80"></div>
            <div class="skeleton-line w60"></div>
            <div class="skeleton-line w40"></div>
          </div>
        </div>
      </div>
      <ChatInput
        :loading="store.loading"
        v-model:retrieval-mode="store.retrievalMode"
        v-model:agent-mode="store.agentMode"
        @send="store.sendMessageStream"
      />
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="ctxMenuVisible"
        class="ctx-menu"
        :style="{ left: ctxMenuX + 'px', top: ctxMenuY + 'px' }"
        @click.stop
      >
        <button class="ctx-item" @click="handlePin">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10 2v16M5 8l5-6 5 6M5 14l5 4 5-4"/></svg>
          {{ store.conversations.find(c => c.id === ctxTargetId)?.pinned ? '取消置顶' : '置顶' }}
        </button>
        <button class="ctx-item" @click="handleRenameStart">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13 3l4 4L7 17H3v-4L13 3z"/></svg>
          重命名
        </button>
        <div class="ctx-divider"></div>
        <button class="ctx-item danger" @click="handleDelete">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 5h12L17 19H3L4 5zM7 5V3a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
          删除
        </button>
      </div>
    </Teleport>

    <!-- 重命名弹窗 -->
    <Teleport to="body">
      <div v-if="renameVisible" class="rename-overlay" @click.self="renameVisible = false">
        <div class="rename-dialog">
          <div class="rename-title">重命名对话</div>
          <input
            v-model="renameText"
            class="rename-input"
            placeholder="输入新名称"
            @keydown.enter="handleRenameConfirm"
            @keydown.escape="renameVisible = false"
            ref="renameInputRef"
          />
          <div class="rename-actions">
            <button class="rename-btn cancel" @click="renameVisible = false">取消</button>
            <button class="rename-btn confirm" @click="handleRenameConfirm">确定</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.qa-layout { display: flex; height: 100%; }

/* Sidebar */
.qa-sidebar {
  width: 260px; background: var(--color-bg-subtle);
  border-right: 1px solid var(--color-ink-100);
  display: flex; flex-direction: column; flex-shrink: 0;
}
.sidebar-head { padding: 20px 20px 16px; border-bottom: 1px solid var(--color-ink-100); }
.sys-name { font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--color-ink-900); }
.sys-sub { font-size: 11px; color: var(--color-ink-300); margin-top: 2px; letter-spacing: 0.04em; }
.search { padding: 12px 16px; border-bottom: 1px solid var(--color-ink-100); }
.search input {
  width: 100%; padding: 7px 10px; border: 1px solid var(--color-ink-100); border-radius: var(--radius-md);
  font-size: 13px; background: var(--color-bg); font-family: var(--font-body); color: var(--color-ink-900); outline: none;
}
.search input:focus { border-color: var(--color-primary); }
.search input::placeholder { color: var(--color-ink-300); }

.conv-list { flex: 1; overflow-y: auto; padding: 4px 0; }
.conv-item {
  padding: 12px 20px; cursor: pointer; transition: background 0.15s;
  border-left: 2px solid transparent; user-select: none;
}
.conv-item:hover { background: rgba(0, 0, 0, 0.02); }
.conv-item.active { background: var(--color-primary-light); border-left-color: var(--color-primary); }
.conv-title { font-size: 13px; font-weight: 500; color: var(--color-ink-900); margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pin-icon { font-size: 10px; margin-right: 2px; }
.conv-time { font-size: 11px; color: var(--color-ink-300); }

.new-btn {
  margin: 12px 16px; padding: 9px; background: transparent; color: var(--color-primary);
  border: 1px solid var(--color-ink-100); border-radius: var(--radius-md); font-size: 12px;
  font-weight: 600; cursor: pointer; font-family: var(--font-body); letter-spacing: 0.04em;
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.new-btn:hover { background: var(--color-primary-light); border-color: var(--color-primary); }
.new-btn svg { width: 12px; height: 12px; }

/* Main */
.qa-main { flex: 1; display: flex; flex-direction: column; background: var(--color-bg); min-width: 0; position: relative; }
.messages { flex: 1; overflow-y: auto; padding: 32px; display: flex; flex-direction: column; gap: 24px; }

/* Error */
.error-bar { background: #FDF2F2; border-bottom: 1px solid #F5C6C6; color: #B83A1F; padding: 10px 24px; font-size: 13px; display: flex; justify-content: space-between; }
.error-close { background: none; border: none; color: #B83A1F; font-size: 18px; cursor: pointer; }

/* Empty */
.empty-state { text-align: center; padding: 80px 40px; }
.empty-title { font-family: var(--font-display); font-size: 20px; font-weight: 600; color: var(--color-ink-700); }
.empty-desc { font-size: 13px; color: var(--color-ink-300); }

/* Skeleton */
.msg { display: flex; gap: 14px; max-width: 700px; }
.msg.assistant { align-self: flex-start; }
.avatar { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: var(--color-ink-100); }
.avatar svg { width: 14px; height: 14px; stroke-width: 1.5; stroke: var(--color-ink-500); }
.skeleton-line { height: 12px; background: var(--color-ink-100); border-radius: 3px; margin-bottom: 8px; animation: shimmer 1.5s infinite; }
.skeleton-line.w80 { width: 80%; }
.skeleton-line.w60 { width: 60%; }
.skeleton-line.w40 { width: 40%; }
@keyframes shimmer { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }

/* 右键菜单 */
.ctx-menu {
  position: fixed; z-index: 9999;
  background: var(--color-surface);
  border: 1px solid var(--color-ink-100);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  padding: 4px; min-width: 150px;
}
.ctx-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 8px 12px; border: none; background: none;
  font-size: 13px; color: var(--color-ink-700); cursor: pointer;
  border-radius: var(--radius-sm); font-family: var(--font-body);
  transition: background 0.1s;
}
.ctx-item:hover { background: var(--color-bg-subtle); }
.ctx-item.danger { color: var(--color-danger); }
.ctx-item.danger:hover { background: var(--color-danger-light); }
.ctx-item svg { width: 14px; height: 14px; flex-shrink: 0; }
.ctx-divider { height: 1px; background: var(--color-ink-100); margin: 4px 0; }

/* 重命名弹窗 */
.rename-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,0.15);
  display: flex; align-items: center; justify-content: center;
}
.rename-dialog {
  background: var(--color-surface); border: 1px solid var(--color-ink-100);
  border-radius: var(--radius-md); padding: 24px; width: 320px;
  box-shadow: var(--shadow-md);
}
.rename-title { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink-900); margin-bottom: 16px; }
.rename-input {
  width: 100%; padding: 10px 12px; border: 1px solid var(--color-ink-100);
  border-radius: var(--radius-md); font-size: 14px; font-family: var(--font-body);
  color: var(--color-ink-900); outline: none; transition: border-color 0.2s;
}
.rename-input:focus { border-color: var(--color-primary); }
.rename-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.rename-btn {
  padding: 8px 18px; border: none; border-radius: var(--radius-md);
  font-size: 13px; cursor: pointer; font-family: var(--font-body); font-weight: 500;
}
.rename-btn.cancel { background: var(--color-bg-subtle); color: var(--color-ink-500); }
.rename-btn.cancel:hover { background: var(--color-ink-100); }
.rename-btn.confirm { background: var(--color-ink-900); color: #fff; }
.rename-btn.confirm:hover { background: var(--color-ink-700); }

@media (max-width: 760px) {
  .qa-layout {
    flex-direction: column;
  }

  .qa-sidebar {
    width: 100%;
    height: 64px;
    min-width: 0;
    flex-direction: row;
    border-right: none;
    border-bottom: 1px solid var(--color-ink-100);
  }

  .sidebar-head,
  .search { display: none; }

  .conv-list {
    display: flex;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 4px;
  }

  .conv-item {
    flex: 0 0 156px;
    padding: 8px 10px;
    border-left: none;
    border-bottom: 2px solid transparent;
  }

  .conv-item.active {
    border-left-color: transparent;
    border-bottom-color: var(--color-primary);
  }

  .new-btn {
    flex: 0 0 44px;
    width: 44px;
    height: 44px;
    margin: 10px;
    padding: 0;
    gap: 0;
    font-size: 0;
  }

  .new-btn svg { width: 16px; height: 16px; }

  .qa-main {
    width: 100%;
    min-height: 0;
  }

  .messages {
    padding: 16px 12px;
    gap: 16px;
  }

  .empty-state { padding: 48px 16px; }
  .empty-title { font-size: 18px; }
  .rename-dialog { width: calc(100vw - 32px); }
}
</style>
