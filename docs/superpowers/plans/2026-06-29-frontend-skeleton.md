# Frontend Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete Vue 3 frontend skeleton with 4 pages, sidebar navigation, axios API layer (mock JSON), and Pinia state management.

**Architecture:** Vue 3 SPA with sidebar icon navigation. API layer wraps axios with interceptors; during development, responses come from static JSON files in `public/mock/`. Pages are built with Element Plus components and scoped CSS using GIS-inspired design tokens.

**Tech Stack:** Vue 3 + TypeScript, Vite 6, Vue Router 4 (hash), Pinia, Element Plus 2.x (auto-import), axios, Scoped CSS

## Global Constraints

- All CSS uses design tokens from `src/styles/global.css` (see Task 2)
- No OpenLayers / AntV G6 / ECharts integration — placeholder components only
- No real auth — mock token in localStorage
- Hash mode routing (`createWebHashHistory`)
- Element Plus auto-imported via `unplugin-vue-components` + `unplugin-auto-import`
- All mock JSON files in `public/mock/`

## File Structure

```
frontend/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── env.d.ts
├── package.json
├── public/
│   └── mock/
│       ├── qa-answer.json
│       ├── qa-history.json
│       └── doc-list.json
└── src/
    ├── main.ts
    ├── App.vue
    ├── styles/
    │   └── global.css
    ├── types/
    │   └── index.ts
    ├── router/
    │   └── index.ts
    ├── api/
    │   ├── request.ts
    │   ├── qa.ts
    │   └── doc.ts
    ├── stores/
    │   ├── user.ts
    │   └── qa.ts
    ├── utils/
    │   ├── sse.ts
    │   └── format.ts
    ├── components/
    │   ├── ChatMessage.vue
    │   ├── ChatInput.vue
    │   ├── SourceCard.vue
    │   ├── StatCard.vue
    │   ├── MapPanel.vue
    │   └── GraphCanvas.vue
    └── views/
        ├── QaView.vue
        ├── MapView.vue
        ├── GraphView.vue
        └── AdminView.vue
```

---

### Task 1: Vite Project Initialization

**Files:**
- Create: `frontend/` (entire directory via `npm create vue@latest`)
- Modify: `frontend/package.json` (add dependencies)
- Create: `frontend/vite.config.ts` (Element Plus auto-import config)

**Interfaces:**
- Produces: Working Vite + Vue 3 + TypeScript project with Element Plus auto-import

- [ ] **Step 1: Create Vue project**

```bash
cd D:/1GISwork/6-GISdevelop
npm create vue@latest frontend -- --typescript --router --pinia
cd frontend
```

When prompted: Yes to TypeScript, Yes to Router, Yes to Pinia, No to Vitest, No to ESLint, No to DevTools.

- [ ] **Step 2: Install dependencies**

```bash
cd D:/1GISwork/6-GISdevelop/frontend
npm install element-plus axios
npm install -D unplugin-vue-components unplugin-auto-import
```

- [ ] **Step 3: Configure vite.config.ts**

Write file `frontend/vite.config.ts`:

```typescript
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
      imports: ['vue', 'vue-router', 'pinia'],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
```

- [ ] **Step 4: Verify build**

```bash
cd D:/1GISwork/6-GISdevelop/frontend
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
cd D:/1GISwork/6-GISdevelop
git add frontend/
git commit -m "feat: initialize Vue 3 + TypeScript + Element Plus project"
```

---

### Task 2: Global Styles + Design Tokens

**Files:**
- Create: `frontend/src/styles/global.css`
- Modify: `frontend/src/main.ts` (import global.css)

**Interfaces:**
- Produces: CSS custom properties available globally via `:root`

- [ ] **Step 1: Create global.css with design tokens**

Write file `frontend/src/styles/global.css`:

```css
:root {
  /* Primitive */
  --color-ink-900: #0F172A;
  --color-ink-700: #334155;
  --color-ink-500: #64748B;
  --color-ink-300: #CBD5E1;
  --color-ink-100: #F1F5F9;

  /* Semantic */
  --color-primary: #0E7490;
  --color-primary-light: #22D3EE;
  --color-primary-dark: #155E75;
  --color-secondary: #059669;
  --color-accent: #D97706;
  --color-danger: #DC2626;
  --color-surface: #FFFFFF;
  --color-bg: #F8FAFC;
  --color-sidebar: #0F172A;
  --color-sidebar-active: #0E7490;

  /* Typography */
  --text-hero: 36px;
  --text-h1: 24px;
  --text-h2: 18px;
  --text-body: 14px;
  --text-caption: 12px;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;

  /* Shadow */
  --shadow-sm: 0 1px 3px rgba(15,23,42,.06);
  --shadow-md: 0 4px 12px rgba(15,23,42,.08);
  --shadow-lg: 0 8px 24px rgba(15,23,42,.12);

  /* Element Plus overrides */
  --el-color-primary: #0E7490;
  --el-color-primary-light-3: #22D3EE;
  --el-color-primary-dark-2: #155E75;
  --el-bg-color: #F8FAFC;
  --el-text-color-primary: #0F172A;
  --el-text-color-regular: #334155;
  --el-text-color-secondary: #64748B;
  --el-border-color: #F1F5F9;
  --el-border-radius-base: 8px;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--color-bg);
  color: var(--color-ink-700);
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 2: Import global.css in main.ts**

Modify `frontend/src/main.ts` to add at the top:

```typescript
import './styles/global.css'
```

The full file should be:

```typescript
import './styles/global.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
```

- [ ] **Step 3: Verify build**

```bash
cd D:/1GISwork/6-GISdevelop/frontend
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd D:/1GISwork/6-GISdevelop
git add frontend/src/styles/ frontend/src/main.ts
git commit -m "feat: add design tokens and global styles"
```

---

### Task 3: TypeScript Types

**Files:**
- Create: `frontend/src/types/index.ts`

**Interfaces:**
- Produces: `Message`, `Source`, `Conversation`, `Document` types used by all subsequent tasks

- [ ] **Step 1: Create types/index.ts**

Write file `frontend/src/types/index.ts`:

```typescript
export interface Source {
  docId: number
  docTitle: string
  page: number
  snippet: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  timestamp: number
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
}

export interface Document {
  docId: number
  title: string
  domain: string
  docType: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  chunkCount: number
  uploadedAt: string
}

export interface QaAskRequest {
  question: string
  conversationId?: string
}

export interface QaAskResponse {
  answer: string
  sources: Source[]
}
```

- [ ] **Step 2: Verify build**

```bash
cd D:/1GISwork/6-GISdevelop/frontend
npm run build
```

- [ ] **Step 3: Commit**

```bash
cd D:/1GISwork/6-GISdevelop
git add frontend/src/types/
git commit -m "feat: add TypeScript type definitions"
```

---

### Task 4: Router Configuration

**Files:**
- Create: `frontend/src/router/index.ts`

**Interfaces:**
- Produces: 4 routes (`/qa`, `/map`, `/graph`, `/admin`) with hash mode

- [ ] **Step 1: Create router/index.ts**

Write file `frontend/src/router/index.ts`:

```typescript
import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/qa',
    },
    {
      path: '/qa',
      name: 'Qa',
      component: () => import('@/views/QaView.vue'),
      meta: { title: '智能问答' },
    },
    {
      path: '/map',
      name: 'Map',
      component: () => import('@/views/MapView.vue'),
      meta: { title: '地图交互' },
    },
    {
      path: '/graph',
      name: 'Graph',
      component: () => import('@/views/GraphView.vue'),
      meta: { title: '知识图谱' },
    },
    {
      path: '/admin',
      name: 'Admin',
      component: () => import('@/views/AdminView.vue'),
      meta: { title: '后台管理' },
    },
  ],
})

export default router
```

- [ ] **Step 2: Create placeholder view files**

Create 4 empty placeholder files so the router doesn't crash:

`frontend/src/views/QaView.vue`:
```vue
<template>
  <div>智能问答 - 占位</div>
</template>
```

`frontend/src/views/MapView.vue`:
```vue
<template>
  <div>地图交互 - 占位</div>
</template>
```

`frontend/src/views/GraphView.vue`:
```vue
<template>
  <div>知识图谱 - 占位</div>
</template>
```

`frontend/src/views/AdminView.vue`:
```vue
<template>
  <div>后台管理 - 占位</div>
</template>
```

- [ ] **Step 3: Verify build**

```bash
cd D:/1GISwork/6-GISdevelop/frontend
npm run build
```

- [ ] **Step 4: Commit**

```bash
cd D:/1GISwork/6-GISdevelop
git add frontend/src/router/ frontend/src/views/
git commit -m "feat: add router config with 4 page routes"
```

---

### Task 5: App.vue Layout (Sidebar + Topbar)

**Files:**
- Create: `frontend/src/App.vue`

**Interfaces:**
- Produces: Shell layout with sidebar navigation and `<router-view>` content area

- [ ] **Step 1: Write App.vue**

Write file `frontend/src/App.vue`:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()

const collapsed = ref(true)

const navItems = [
  { path: '/qa', icon: '💬', label: '智能问答' },
  { path: '/map', icon: '🗺', label: '地图交互' },
  { path: '/graph', icon: '🔗', label: '知识图谱' },
  { path: '/admin', icon: '📊', label: '后台管理' },
]

const pageTitle = computed(() => (route.meta?.title as string) || '首页')

function navigate(path: string) {
  router.push(path)
}
</script>

<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="logo" @click="navigate('/qa')">GK</div>
      <nav class="nav">
        <button
          v-for="item in navItems"
          :key="item.path"
          class="icon-btn"
          :class="{ active: route.path === item.path }"
          @click="navigate(item.path)"
        >
          {{ item.icon }}
          <span class="tip">{{ item.label }}</span>
        </button>
      </nav>
      <div class="bottom-btns">
        <button class="icon-btn">⚙<span class="tip">设置</span></button>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <span class="page-title">{{ pageTitle }}</span>
      </header>
      <section class="content">
        <router-view />
      </section>
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  width: 56px;
  background: var(--color-sidebar);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  gap: 4px;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}

.sidebar::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: .06;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cpath d='M20 100 Q60 60 100 80 T180 70' fill='none' stroke='%2322D3EE' stroke-width='1.5'/%3E%3Cpath d='M10 130 Q50 90 90 110 T170 100' fill='none' stroke='%2322D3EE' stroke-width='1'/%3E%3Cpath d='M30 160 Q70 120 110 140 T190 130' fill='none' stroke='%2322D3EE' stroke-width='0.8'/%3E%3C/svg%3E");
  pointer-events: none;
}

.logo {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--color-primary), var(--color-secondary));
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  margin-bottom: 16px;
  cursor: pointer;
  position: relative;
  z-index: 1;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  width: 100%;
  align-items: center;
  position: relative;
  z-index: 1;
}

.icon-btn {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  cursor: pointer;
  transition: all .2s;
  position: relative;
  border: none;
  background: transparent;
  color: rgba(255,255,255,.35);
}

.icon-btn:hover {
  background: rgba(255,255,255,.08);
  color: rgba(255,255,255,.7);
}

.icon-btn.active {
  background: var(--color-sidebar-active);
  color: #fff;
  box-shadow: 0 0 12px rgba(14,116,144,.4);
}

.icon-btn .tip {
  position: absolute;
  left: 52px;
  background: rgba(15,23,42,.9);
  color: #fff;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity .15s;
}

.icon-btn:hover .tip {
  opacity: 1;
}

.bottom-btns {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  align-items: center;
  position: relative;
  z-index: 1;
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.topbar {
  height: 44px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-ink-100);
  display: flex;
  align-items: center;
  padding: 0 20px;
  flex-shrink: 0;
}

.page-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-ink-900);
}

.content {
  flex: 1;
  overflow: hidden;
}
</style>
```

- [ ] **Step 2: Verify dev server starts**

```bash
cd D:/1GISwork/6-GISdevelop/frontend
npm run dev
```

Expected: Server starts, open browser to see sidebar layout with placeholder pages.

- [ ] **Step 3: Commit**

```bash
cd D:/1GISwork/6-GISdevelop
git add frontend/src/App.vue
git commit -m "feat: add sidebar layout shell with navigation"
```

---

### Task 6: Axios Request Instance

**Files:**
- Create: `frontend/src/api/request.ts`

**Interfaces:**
- Produces: `request` axios instance with interceptors; used by all API modules

- [ ] **Step 1: Create api/request.ts**

Write file `frontend/src/api/request.ts`:

```typescript
import axios from 'axios'
import { ElMessage } from 'element-plus'

const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
  timeout: 15000,
})

request.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

request.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      ElMessage.error('登录已过期，请重新登录')
    } else {
      ElMessage.error(error.message || '请求失败')
    }
    return Promise.reject(error)
  }
)

export default request
```

- [ ] **Step 2: Verify build**

```bash
cd D:/1GISwork/6-GISdevelop/frontend
npm run build
```

- [ ] **Step 3: Commit**

```bash
cd D:/1GISwork/6-GISdevelop
git add frontend/src/api/request.ts
git commit -m "feat: add axios request instance with interceptors"
```

---

### Task 7: Mock JSON Files

**Files:**
- Create: `frontend/public/mock/qa-answer.json`
- Create: `frontend/public/mock/qa-history.json`
- Create: `frontend/public/mock/doc-list.json`

**Interfaces:**
- Produces: Static JSON files consumed by API modules

- [ ] **Step 1: Create qa-answer.json**

Write file `frontend/public/mock/qa-answer.json`:

```json
{
  "answer": "根据《国土空间调查、规划、用途管制用地用海分类指南》，养老院属于**社会福利用地（0807）**，归类于公共管理与公共服务用地大类。\n\n在城镇开发边界内建设养老院，需满足以下管控要求：\n\n1. **用地兼容性**：需确认该地块规划用途是否兼容社会福利用地；\n2. **容积率与建筑密度**：须符合所在分区的规划指标；\n3. **配套要求**：需配套无障碍设施、绿地率不低于 30%。\n\n建议进一步核实该地块在总体规划中的具体分区属性。",
  "sources": [
    { "docId": 1, "docTitle": "用地用海分类指南", "page": 12, "snippet": "社会福利用地（0807）属于公共管理与公共服务用地..." },
    { "docId": 2, "docTitle": "市级国土空间总体规划", "page": 45, "snippet": "城镇开发边界内各类用地的管控要求..." },
    { "docId": 3, "docTitle": "规划编制指南", "page": 23, "snippet": "公共服务设施配套要求..." }
  ]
}
```

- [ ] **Step 2: Create qa-history.json**

Write file `frontend/public/mock/qa-history.json`:

```json
[
  { "id": "conv-1", "title": "城关镇养老院合规性", "createdAt": 1719650000000 },
  { "id": "conv-2", "title": "城镇开发边界划定原则", "createdAt": 1719637000000 },
  { "id": "conv-3", "title": "用地分类中养老设施", "createdAt": 1719570000000 },
  { "id": "conv-4", "title": "PostGIS 空间查询语法", "createdAt": 1719540000000 }
]
```

- [ ] **Step 3: Create doc-list.json**

Write file `frontend/public/mock/doc-list.json`:

```json
[
  { "docId": 1, "title": "市级国土空间总体规划（2021-2035）", "domain": "国土空间规划", "docType": "规划文本", "status": "completed", "chunkCount": 486, "uploadedAt": "2026-06-28" },
  { "docId": 2, "title": "国土空间调查规划用途管制用地用海分类指南", "domain": "国土空间规划", "docType": "国家标准", "status": "completed", "chunkCount": 312, "uploadedAt": "2026-06-28" },
  { "docId": 3, "title": "市级国土空间总体规划编制指南（试行）", "domain": "国土空间规划", "docType": "技术规范", "status": "processing", "chunkCount": 0, "uploadedAt": "2026-06-29" },
  { "docId": 4, "title": "城镇开发边界管理办法", "domain": "国土空间规划", "docType": "政策文件", "status": "pending", "chunkCount": 0, "uploadedAt": "2026-06-29" },
  { "docId": 5, "title": "国土空间规划城市体检评估规程", "domain": "国土空间规划", "docType": "技术规范", "status": "completed", "chunkCount": 449, "uploadedAt": "2026-06-27" }
]
```

- [ ] **Step 4: Commit**

```bash
cd D:/1GISwork/6-GISdevelop
git add frontend/public/mock/
git commit -m "feat: add mock JSON data files"
```

---

### Task 8: API Layer (qa.ts + doc.ts)

**Files:**
- Create: `frontend/src/api/qa.ts`
- Create: `frontend/src/api/doc.ts`

**Interfaces:**
- Produces: `askQuestion()`, `getHistory()`, `getDocList()` functions used by stores and views

- [ ] **Step 1: Create api/qa.ts**

Write file `frontend/src/api/qa.ts`:

```typescript
import type { QaAskResponse, Conversation } from '@/types'

const isDev = import.meta.env.DEV

export async function askQuestion(question: string): Promise<QaAskResponse> {
  if (isDev) {
    const res = await fetch('/mock/qa-answer.json')
    return res.json()
  }
  const { default: request } = await import('./request')
  return request.post('/qa/ask', { question })
}

export async function getHistory(): Promise<Conversation[]> {
  if (isDev) {
    const res = await fetch('/mock/qa-history.json')
    return res.json()
  }
  const { default: request } = await import('./request')
  return request.get('/qa/history')
}
```

- [ ] **Step 2: Create api/doc.ts**

Write file `frontend/src/api/doc.ts`:

```typescript
import type { Document } from '@/types'

const isDev = import.meta.env.DEV

export async function getDocList(): Promise<Document[]> {
  if (isDev) {
    const res = await fetch('/mock/doc-list.json')
    return res.json()
  }
  const { default: request } = await import('./request')
  return request.get('/admin/docs')
}
```

- [ ] **Step 3: Verify build**

```bash
cd D:/1GISwork/6-GISdevelop/frontend
npm run build
```

- [ ] **Step 4: Commit**

```bash
cd D:/1GISwork/6-GISdevelop
git add frontend/src/api/
git commit -m "feat: add API layer with mock fallback"
```

---

### Task 9: Pinia Stores

**Files:**
- Create: `frontend/src/stores/user.ts`
- Create: `frontend/src/stores/qa.ts`

**Interfaces:**
- Produces: `useUserStore`, `useQaStore` used by views and components

- [ ] **Step 1: Create stores/user.ts**

Write file `frontend/src/stores/user.ts`:

```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUserStore = defineStore('user', () => {
  const token = ref<string | null>(localStorage.getItem('token'))
  const username = ref('admin')
  const role = ref<'user' | 'admin'>('admin')

  function setToken(t: string) {
    token.value = t
    localStorage.setItem('token', t)
  }

  function logout() {
    token.value = null
    localStorage.removeItem('token')
  }

  return { token, username, role, setToken, logout }
})
```

- [ ] **Step 2: Create stores/qa.ts**

Write file `frontend/src/stores/qa.ts`:

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Message, Conversation } from '@/types'
import { getHistory, askQuestion } from '@/api/qa'

export const useQaStore = defineStore('qa', () => {
  const conversations = ref<Conversation[]>([])
  const currentId = ref<string | null>(null)
  const messages = ref<Message[]>([])
  const loading = ref(false)

  const currentConversation = computed(() =>
    conversations.value.find((c) => c.id === currentId.value)
  )

  async function loadHistory() {
    conversations.value = await getHistory()
    if (conversations.value.length > 0 && !currentId.value) {
      selectConversation(conversations.value[0].id)
    }
  }

  function selectConversation(id: string) {
    currentId.value = id
    messages.value = []
  }

  function createConversation() {
    const id = `conv-${Date.now()}`
    const conv: Conversation = { id, title: '新对话', createdAt: Date.now() }
    conversations.value.unshift(conv)
    currentId.value = id
    messages.value = []
  }

  async function sendMessage(content: string) {
    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    messages.value.push(userMsg)
    loading.value = true

    try {
      const res = await askQuestion(content)
      const aiMsg: Message = {
        id: `msg-${Date.now()}-ai`,
        role: 'assistant',
        content: res.answer,
        sources: res.sources,
        timestamp: Date.now(),
      }
      messages.value.push(aiMsg)
    } finally {
      loading.value = false
    }
  }

  return {
    conversations,
    currentId,
    messages,
    loading,
    currentConversation,
    loadHistory,
    selectConversation,
    createConversation,
    sendMessage,
  }
})
```

- [ ] **Step 3: Verify build**

```bash
cd D:/1GISwork/6-GISdevelop/frontend
npm run build
```

- [ ] **Step 4: Commit**

```bash
cd D:/1GISwork/6-GISdevelop
git add frontend/src/stores/
git commit -m "feat: add Pinia stores for user and QA state"
```

---

### Task 10: Utility Functions

**Files:**
- Create: `frontend/src/utils/format.ts`

**Interfaces:**
- Produces: `formatTime()` used by components

- [ ] **Step 1: Create utils/format.ts**

Write file `frontend/src/utils/format.ts`:

```typescript
export function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()

  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

  if (isToday) return `今天 ${time}`

  const isYesterday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate() - 1

  if (isYesterday) return `昨天 ${time}`

  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}
```

- [ ] **Step 2: Verify build**

```bash
cd D:/1GISwork/6-GISdevelop/frontend
npm run build
```

- [ ] **Step 3: Commit**

```bash
cd D:/1GISwork/6-GISdevelop
git add frontend/src/utils/
git commit -m "feat: add format utility functions"
```

---

### Task 11: Chat Components (ChatMessage + ChatInput + SourceCard)

**Files:**
- Create: `frontend/src/components/ChatMessage.vue`
- Create: `frontend/src/components/ChatInput.vue`
- Create: `frontend/src/components/SourceCard.vue`

**Interfaces:**
- Consumes: `Message`, `Source` types from `@/types`
- Produces: Components used by QaView

- [ ] **Step 1: Create ChatMessage.vue**

Write file `frontend/src/components/ChatMessage.vue`:

```vue
<script setup lang="ts">
import type { Message } from '@/types'
import SourceCard from './SourceCard.vue'

defineProps<{ message: Message }>()
</script>

<template>
  <div class="chat-msg" :class="message.role">
    <div class="avatar">{{ message.role === 'user' ? '👤' : '🤖' }}</div>
    <div class="content">
      <div class="bubble" v-html="message.content" />
      <div v-if="message.sources?.length" class="sources">
        <SourceCard v-for="s in message.sources" :key="s.docId + '-' + s.page" :source="s" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-msg {
  display: flex;
  gap: 10px;
  max-width: 80%;
}
.chat-msg.user {
  align-self: flex-end;
  flex-direction: row-reverse;
}
.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}
.user .avatar { background: var(--color-primary); }
.ai .avatar { background: var(--color-secondary); }
.bubble {
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.7;
}
.user .bubble {
  background: var(--color-primary);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.ai .bubble {
  background: var(--color-surface);
  color: var(--color-ink-900);
  border: 1px solid var(--color-ink-100);
  border-bottom-left-radius: 4px;
  box-shadow: var(--shadow-sm);
}
.sources {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}
</style>
```

- [ ] **Step 2: Create ChatInput.vue**

Write file `frontend/src/components/ChatInput.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{ send: [text: string] }>()
defineProps<{ loading?: boolean }>()

const text = ref('')

function handleSend() {
  const trimmed = text.value.trim()
  if (!trimmed) return
  emit('send', trimmed)
  text.value = ''
}
</script>

<template>
  <div class="chat-input-area">
    <div class="input-row">
      <textarea
        v-model="text"
        placeholder="输入你的问题..."
        @keydown.enter.exact.prevent="handleSend"
      />
      <button class="send-btn" :disabled="loading" @click="handleSend">
        {{ loading ? '生成中...' : '发送' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-input-area {
  padding: 16px 24px;
  background: var(--color-surface);
  border-top: 1px solid var(--color-ink-100);
}
.input-row {
  display: flex;
  gap: 10px;
}
textarea {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--color-ink-100);
  border-radius: 8px;
  font-size: 14px;
  resize: none;
  height: 44px;
  outline: none;
  font-family: inherit;
  background: var(--color-bg);
  transition: border-color .2s;
}
textarea:focus {
  border-color: var(--color-primary);
  background: var(--color-surface);
}
textarea::placeholder {
  color: var(--color-ink-300);
}
.send-btn {
  padding: 0 24px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 500;
  transition: background .2s;
}
.send-btn:hover:not(:disabled) {
  background: var(--color-primary-dark);
}
.send-btn:disabled {
  opacity: .6;
  cursor: not-allowed;
}
</style>
```

- [ ] **Step 3: Create SourceCard.vue**

Write file `frontend/src/components/SourceCard.vue`:

```vue
<script setup lang="ts">
import type { Source } from '@/types'

defineProps<{ source: Source }>()
</script>

<template>
  <span class="source-tag">📄 {{ source.docTitle }} p.{{ source.page }}</span>
</template>

<style scoped>
.source-tag {
  font-size: 11px;
  padding: 3px 10px;
  background: rgba(5,150,105,.08);
  color: var(--color-secondary);
  border-radius: 10px;
  border: 1px solid rgba(5,150,105,.15);
  font-weight: 500;
}
</style>
```

- [ ] **Step 4: Verify build**

```bash
cd D:/1GISwork/6-GISdevelop/frontend
npm run build
```

- [ ] **Step 5: Commit**

```bash
cd D:/1GISwork/6-GISdevelop
git add frontend/src/components/
git commit -m "feat: add ChatMessage, ChatInput, SourceCard components"
```

---

### Task 12: QaView Page

**Files:**
- Modify: `frontend/src/views/QaView.vue` (replace placeholder)

**Interfaces:**
- Consumes: `useQaStore`, `ChatMessage`, `ChatInput` components
- Produces: Working Q&A page with conversation list and message display

- [ ] **Step 1: Write QaView.vue**

Write file `frontend/src/views/QaView.vue`:

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useQaStore } from '@/stores/qa'
import ChatMessage from '@/components/ChatMessage.vue'
import ChatInput from '@/components/ChatInput.vue'
import { formatTime } from '@/utils/format'

const store = useQaStore()

onMounted(() => {
  store.loadHistory()
})
</script>

<template>
  <div class="qa-layout">
    <aside class="qa-sidebar">
      <div class="search">
        <input placeholder="搜索对话..." />
      </div>
      <div class="conv-list">
        <div
          v-for="conv in store.conversations"
          :key="conv.id"
          class="conv-item"
          :class="{ active: store.currentId === conv.id }"
          @click="store.selectConversation(conv.id)"
        >
          <div class="conv-title">{{ conv.title }}</div>
          <div class="conv-time">{{ formatTime(conv.createdAt) }}</div>
        </div>
      </div>
      <button class="new-btn" @click="store.createConversation">+ 新建对话</button>
    </aside>
    <div class="qa-main">
      <div class="messages">
        <ChatMessage v-for="msg in store.messages" :key="msg.id" :message="msg" />
        <div v-if="store.loading" class="loading-hint">正在生成回答...</div>
      </div>
      <ChatInput :loading="store.loading" @send="store.sendMessage" />
    </div>
  </div>
</template>

<style scoped>
.qa-layout {
  display: flex;
  height: 100%;
}
.qa-sidebar {
  width: 240px;
  background: var(--color-surface);
  border-right: 1px solid var(--color-ink-100);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.search {
  padding: 12px;
  border-bottom: 1px solid var(--color-ink-100);
}
.search input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-ink-100);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  background: var(--color-bg);
}
.search input:focus {
  border-color: var(--color-primary);
}
.conv-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.conv-item {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 2px;
  transition: background .15s;
}
.conv-item:hover { background: var(--color-ink-100); }
.conv-item.active {
  background: rgba(14,116,144,.08);
  border-left: 3px solid var(--color-primary);
}
.conv-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-ink-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conv-time {
  font-size: 11px;
  color: var(--color-ink-500);
  margin-top: 2px;
}
.new-btn {
  margin: 12px;
  padding: 10px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-weight: 500;
}
.new-btn:hover { background: var(--color-primary-dark); }
.qa-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.loading-hint {
  font-size: 13px;
  color: var(--color-ink-500);
  padding: 8px 0;
}
</style>
```

- [ ] **Step 2: Verify dev server and test interaction**

```bash
cd D:/1GISwork/6-GISdevelop/frontend
npm run dev
```

Open browser, navigate to Q&A page, click conversations, send a message. Expected: mock response appears.

- [ ] **Step 3: Commit**

```bash
cd D:/1GISwork/6-GISdevelop
git add frontend/src/views/QaView.vue
git commit -m "feat: implement QaView with conversation list and chat"
```

---

### Task 13: StatCard Component

**Files:**
- Create: `frontend/src/components/StatCard.vue`

**Interfaces:**
- Produces: `StatCard` component used by AdminView

- [ ] **Step 1: Create StatCard.vue**

Write file `frontend/src/components/StatCard.vue`:

```vue
<script setup lang="ts">
defineProps<{
  label: string
  value: string | number
  unit?: string
}>()
</script>

<template>
  <div class="stat-box">
    <div class="stat-label">{{ label }}</div>
    <div class="stat-value">{{ value }}<span v-if="unit" class="stat-unit">{{ unit }}</span></div>
  </div>
</template>

<style scoped>
.stat-box {
  flex: 1;
  background: var(--color-surface);
  border: 1px solid var(--color-ink-100);
  border-radius: 8px;
  padding: 16px 20px;
  box-shadow: var(--shadow-sm);
}
.stat-label {
  font-size: 12px;
  color: var(--color-ink-500);
  margin-bottom: 6px;
  font-weight: 500;
}
.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--color-ink-900);
}
.stat-unit {
  font-size: 13px;
  color: var(--color-ink-500);
  margin-left: 4px;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
cd D:/1GISwork/6-GISdevelop
git add frontend/src/components/StatCard.vue
git commit -m "feat: add StatCard component"
```

---

### Task 14: AdminView Page

**Files:**
- Modify: `frontend/src/views/AdminView.vue` (replace placeholder)

**Interfaces:**
- Consumes: `useQaStore` (for stats), `getDocList()`, `StatCard` component
- Produces: Working admin page with stats cards and document table

- [ ] **Step 1: Write AdminView.vue**

Write file `frontend/src/views/AdminView.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { Document } from '@/types'
import { getDocList } from '@/api/doc'
import StatCard from '@/components/StatCard.vue'

const docs = ref<Document[]>([])
const activeTab = ref('docs')

const statusMap: Record<string, { label: string; class: string }> = {
  completed: { label: '已完成', class: 'done' },
  processing: { label: '处理中', class: 'processing' },
  pending: { label: '待处理', class: 'pending' },
  failed: { label: '失败', class: 'pending' },
}

onMounted(async () => {
  docs.value = await getDocList()
})

const totalChunks = () => docs.value.reduce((sum, d) => sum + d.chunkCount, 0)
</script>

<template>
  <div class="admin-layout">
    <div class="stat-row">
      <StatCard label="文档总数" :value="docs.length" unit="份" />
      <StatCard label="文本切片" :value="totalChunks().toLocaleString()" unit="片" />
      <StatCard label="图谱节点" value="326" unit="个" />
      <StatCard label="问答次数" value="89" unit="次" />
    </div>
    <div class="admin-header">
      <h2>文档管理</h2>
      <button class="upload-btn">+ 上传文档</button>
    </div>
    <div class="tabs">
      <button
        v-for="tab in [{ id: 'docs', label: '文档管理' }, { id: 'entities', label: '实体管理' }, { id: 'config', label: '检索配置' }, { id: 'logs', label: '问答日志' }]"
        :key="tab.id"
        class="tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>
    <table class="doc-table">
      <thead>
        <tr>
          <th>文档标题</th>
          <th>类型</th>
          <th>状态</th>
          <th>切片数</th>
          <th>上传时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="doc in docs" :key="doc.docId">
          <td>{{ doc.title }}</td>
          <td>{{ doc.docType }}</td>
          <td><span class="status-tag" :class="statusMap[doc.status]?.class">{{ statusMap[doc.status]?.label }}</span></td>
          <td>{{ doc.chunkCount || '—' }}</td>
          <td>{{ doc.uploadedAt }}</td>
          <td>
            <span class="action-link">查看</span>
            <span class="action-link danger">删除</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.admin-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
  gap: 16px;
  overflow-y: auto;
}
.stat-row {
  display: flex;
  gap: 16px;
}
.admin-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.admin-header h2 {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-ink-900);
}
.upload-btn {
  padding: 8px 20px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-weight: 500;
}
.upload-btn:hover { background: var(--color-primary-dark); }
.tabs {
  display: flex;
  border-bottom: 2px solid var(--color-ink-100);
}
.tab {
  padding: 10px 20px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  background: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  color: var(--color-ink-500);
}
.tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  font-weight: 600;
}
.tab:hover { color: var(--color-primary); }
.doc-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--color-ink-100);
}
.doc-table th {
  background: var(--color-ink-100);
  padding: 12px 16px;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink-500);
}
.doc-table td {
  padding: 12px 16px;
  font-size: 13px;
  border-bottom: 1px solid var(--color-ink-100);
  color: var(--color-ink-700);
}
.doc-table tr:last-child td { border-bottom: none; }
.doc-table tr:hover td { background: rgba(14,116,144,.02); }
.status-tag {
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
}
.status-tag.done { background: rgba(5,150,105,.1); color: var(--color-secondary); }
.status-tag.processing { background: rgba(217,119,6,.1); color: var(--color-accent); }
.status-tag.pending { background: var(--color-ink-100); color: var(--color-ink-500); }
.action-link {
  color: var(--color-primary);
  cursor: pointer;
  font-size: 12px;
  margin-right: 12px;
  font-weight: 500;
}
.action-link:hover { text-decoration: underline; }
.action-link.danger { color: var(--color-danger); }
</style>
```

- [ ] **Step 2: Verify dev server**

```bash
cd D:/1GISwork/6-GISdevelop/frontend
npm run dev
```

Navigate to admin page. Expected: stats cards + document table with mock data.

- [ ] **Step 3: Commit**

```bash
cd D:/1GISwork/6-GISdevelop
git add frontend/src/views/AdminView.vue
git commit -m "feat: implement AdminView with stats and document table"
```

---

### Task 15: MapView and GraphView (Placeholder Pages)

**Files:**
- Modify: `frontend/src/views/MapView.vue` (replace placeholder)
- Modify: `frontend/src/views/GraphView.vue` (replace placeholder)

**Interfaces:**
- Produces: MapView with toolbar placeholder, GraphView with SVG mock graph

- [ ] **Step 1: Write MapView.vue**

Write file `frontend/src/views/MapView.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'

const tools = [
  { icon: '📌', label: '绘制地块' },
  { icon: '🔍', label: '空间查询' },
  { icon: '📐', label: '缓冲区分析' },
  { icon: '🗺', label: '切换底图' },
  { icon: '🗑', label: '清除' },
]

const activeTool = ref(3)
</script>

<template>
  <div class="map-layout">
    <div class="map-container">
      <div class="placeholder">
        <div class="grid-bg" />
        <div class="label">🗺 OpenLayers 地图 · 底图 + 矢量图层 · 后面接入</div>
      </div>
    </div>
    <div class="toolbar">
      <button
        v-for="(tool, i) in tools"
        :key="i"
        class="tool-btn"
        :class="{ active: activeTool === i }"
        @click="activeTool = i"
      >
        {{ tool.icon }} {{ tool.label }}
      </button>
      <div style="flex:1" />
      <span class="hint">点击地图区域进行交互</span>
    </div>
  </div>
</template>

<style scoped>
.map-layout { display: flex; flex-direction: column; height: 100%; }
.map-container { flex: 1; background: #e8e8e8; position: relative; overflow: hidden; }
.placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.grid-bg {
  position: absolute; inset: 0;
  background-image: linear-gradient(rgba(14,116,144,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(14,116,144,.06) 1px, transparent 1px);
  background-size: 40px 40px;
}
.label {
  position: relative; z-index: 1;
  font-size: 14px; color: var(--color-ink-500);
  background: rgba(255,255,255,.9); padding: 10px 20px;
  border-radius: 8px; border: 1px solid var(--color-ink-100);
  box-shadow: var(--shadow-sm);
}
.toolbar {
  height: 48px; background: var(--color-surface);
  border-top: 1px solid var(--color-ink-100);
  display: flex; align-items: center; padding: 0 16px; gap: 8px;
}
.tool-btn {
  padding: 6px 14px; border: 1px solid var(--color-ink-100);
  border-radius: 6px; background: var(--color-surface);
  font-size: 12px; cursor: pointer; color: var(--color-ink-700);
  transition: all .15s;
}
.tool-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.tool-btn.active { background: rgba(14,116,144,.08); border-color: var(--color-primary); color: var(--color-primary); font-weight: 500; }
.hint { font-size: 11px; color: var(--color-ink-500); }
</style>
```

- [ ] **Step 2: Write GraphView.vue**

Write file `frontend/src/views/GraphView.vue`:

```vue
<script setup lang="ts">
const entityTypes = [
  { color: 'var(--color-primary)', label: '文档', count: 3 },
  { color: 'var(--color-secondary)', label: '实体', count: 12 },
  { color: 'var(--color-accent)', label: '概念', count: 8 },
  { color: 'var(--color-danger)', label: '标准', count: 4 },
]

const relationTypes = [
  { label: '引用', count: 6 },
  { label: '包含', count: 9 },
  { label: '属于', count: 5 },
]
</script>

<template>
  <div class="graph-layout">
    <aside class="panel">
      <div class="panel-title"><span class="deco" />知识图谱</div>
      <div class="search-box"><input placeholder="搜索实体..." /></div>
      <div class="filter-group">
        <div class="filter-label">实体类型</div>
        <div v-for="t in entityTypes" :key="t.label" class="entity-item">
          <span class="dot" :style="{ background: t.color }" />{{ t.label }} ({{ t.count }})
        </div>
      </div>
      <div class="filter-group">
        <div class="filter-label">关系类型</div>
        <div v-for="t in relationTypes" :key="t.label" class="entity-item">
          <span class="dot" style="background:var(--color-ink-300)" />{{ t.label }} ({{ t.count }})
        </div>
      </div>
    </aside>
    <div class="canvas">
      <div class="mock-graph">
        <div class="node" style="background:var(--color-primary);left:30%;top:25%">总体规划</div>
        <div class="node" style="background:var(--color-secondary);left:55%;top:18%">城镇开发边界</div>
        <div class="node" style="background:var(--color-accent);left:18%;top:52%">用地分类</div>
        <div class="node" style="background:var(--color-danger);left:65%;top:48%">管控要求</div>
        <div class="node" style="background:var(--color-primary);left:42%;top:68%">养老院</div>
        <div class="node" style="background:var(--color-secondary);left:78%;top:65%">社会福利用地</div>
        <svg class="edges">
          <line x1="33%" y1="28%" x2="55%" y2="22%" stroke="var(--color-ink-300)" stroke-width="2" />
          <line x1="33%" y1="28%" x2="22%" y2="52%" stroke="var(--color-ink-300)" stroke-width="2" />
          <line x1="58%" y1="22%" x2="67%" y2="48%" stroke="var(--color-ink-300)" stroke-width="2" />
          <line x1="22%" y1="55%" x2="44%" y2="68%" stroke="var(--color-ink-300)" stroke-width="2" />
          <line x1="44%" y1="70%" x2="67%" y2="50%" stroke="var(--color-ink-300)" stroke-width="2" />
          <line x1="44%" y1="70%" x2="78%" y2="66%" stroke="var(--color-ink-300)" stroke-width="2" />
          <text x="42%" y="22%" fill="var(--color-ink-500)" font-size="10">划定</text>
          <text x="24%" y="38%" fill="var(--color-ink-500)" font-size="10">依据</text>
          <text x="60%" y="34%" fill="var(--color-ink-500)" font-size="10">约束</text>
          <text x="30%" y="62%" fill="var(--color-ink-500)" font-size="10">适用</text>
          <text x="54%" y="64%" fill="var(--color-ink-500)" font-size="10">管控</text>
          <text x="58%" y="72%" fill="var(--color-ink-500)" font-size="10">归类</text>
        </svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph-layout { display: flex; height: 100%; }
.panel {
  width: 220px; background: var(--color-surface);
  border-right: 1px solid var(--color-ink-100);
  display: flex; flex-direction: column; flex-shrink: 0;
}
.panel-title {
  padding: 14px 16px; font-size: 14px; font-weight: 600;
  color: var(--color-ink-900); border-bottom: 1px solid var(--color-ink-100);
  display: flex; align-items: center; gap: 8px;
}
.deco { width: 8px; height: 8px; border-radius: 50%; background: var(--color-primary); box-shadow: 0 0 6px rgba(14,116,144,.3); }
.search-box { padding: 12px; border-bottom: 1px solid var(--color-ink-100); }
.search-box input {
  width: 100%; padding: 7px 10px; border: 1px solid var(--color-ink-100);
  border-radius: 6px; font-size: 13px; outline: none; background: var(--color-bg);
}
.search-box input:focus { border-color: var(--color-primary); }
.filter-group { padding: 12px 16px; }
.filter-label {
  font-size: 11px; color: var(--color-ink-500); margin-bottom: 8px;
  text-transform: uppercase; letter-spacing: .5px; font-weight: 500;
}
.entity-item {
  padding: 8px 12px; font-size: 13px; cursor: pointer;
  border-radius: 6px; display: flex; align-items: center; gap: 8px;
  color: var(--color-ink-700); transition: background .15s;
}
.entity-item:hover { background: var(--color-ink-100); }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.canvas { flex: 1; background: var(--color-bg); position: relative; overflow: hidden; }
.mock-graph { position: absolute; inset: 0; }
.node {
  position: absolute; width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600; color: #fff; cursor: grab;
  box-shadow: 0 2px 8px rgba(15,23,42,.15); transition: transform .2s;
}
.node:hover { transform: scale(1.1); }
.edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
</style>
```

- [ ] **Step 3: Verify all pages work**

```bash
cd D:/1GISwork/6-GISdevelop/frontend
npm run dev
```

Navigate through all 4 pages. Each should render correctly.

- [ ] **Step 4: Commit**

```bash
cd D:/1GISwork/6-GISdevelop
git add frontend/src/views/MapView.vue frontend/src/views/GraphView.vue
git commit -m "feat: implement MapView and GraphView placeholder pages"
```

---

### Task 16: Final Build Verification

**Files:**
- None (verification only)

- [ ] **Step 1: Full production build**

```bash
cd D:/1GISwork/6-GISdevelop/frontend
npm run build
```

Expected: Build succeeds, no TypeScript errors, no missing imports.

- [ ] **Step 2: Verify all routes work**

```bash
cd D:/1GISwork/6-GISdevelop/frontend
npm run dev
```

Open browser, test all 4 routes: `/#/qa`, `/#/map`, `/#/graph`, `/#/admin`. Each page should render with correct layout and mock data.

- [ ] **Step 3: Final commit**

```bash
cd D:/1GISwork/6-GISdevelop
git add -A
git commit -m "feat: complete frontend skeleton with 4 pages"
```
