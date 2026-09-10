# 前端骨架设计文档

> 日期：2026-06-29
> 状态：待确认
> Mockup：`docs/page-mockups.html`

## 1. 目标

为 Geo-KG + RAG 智能问答系统搭建前端完整骨架，包含 4 个页面（智能问答、地图交互、知识图谱、后台管理）、侧边栏导航布局、axios API 层（mock JSON）、Pinia 状态管理。后端就绪后只需替换 mock 为真实接口。

**非目标：** 本次不做 OpenLayers/AntV G6/ECharts 的真实集成（仅留页面占位），不做登录鉴权逻辑（mock token），不做响应式移动端适配。

## 2. 技术栈

| 项目 | 选型 | 说明 |
|------|------|------|
| 构建工具 | Vite 6 | Vue 3 官方推荐 |
| 框架 | Vue 3 + TypeScript | 组合式 API (`<script setup>`) |
| 路由 | Vue Router 4 | hash 模式 |
| 状态管理 | Pinia | Vue 3 官方状态库 |
| UI 组件库 | Element Plus 2.x | 按需引入（unplugin-vue-components） |
| HTTP | axios | 封装拦截器 |
| CSS | Scoped CSS | 不使用预处理器 |

## 3. 布局

侧边栏图标导航（56px 宽），点击切换页面。Element Plus `el-menu` collapse 模式。

```
┌──────┬──────────────────────────────┐
│      │  顶栏（页面标题）              │
│ 侧边 │──────────────────────────────│
│ 栏   │                              │
│ 图标 │  内容区（当前页面）            │
│ 导航 │                              │
│      │                              │
└──────┴──────────────────────────────┘
```

## 4. 项目结构

```
frontend/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
└── src/
    ├── main.ts                 # 入口
    ├── App.vue                 # 根组件（侧边栏布局壳）
    ├── api/                    # 接口层
    │   ├── request.ts          # axios 实例
    │   ├── qa.ts               # 问答接口
    │   ├── doc.ts              # 文档接口
    │   ├── kg.ts               # 知识图谱接口
    │   └── spatial.ts          # 空间分析接口
    ├── views/                  # 页面
    │   ├── QaView.vue          # 智能问答
    │   ├── MapView.vue         # 地图交互
    │   ├── GraphView.vue       # 知识图谱
    │   └── AdminView.vue       # 后台管理
    ├── components/             # 复用组件
    │   ├── ChatMessage.vue     # 单条消息
    │   ├── ChatInput.vue       # 输入框
    │   ├── SourceCard.vue      # 溯源卡片
    │   ├── MapPanel.vue        # 地图容器（占位）
    │   ├── GraphCanvas.vue     # 图谱画布（占位）
    │   └── StatCard.vue        # 统计卡片
    ├── stores/                 # Pinia
    │   ├── user.ts             # 用户状态
    │   └── qa.ts               # 问答状态
    ├── router/
    │   └── index.ts            # 路由配置
    ├── utils/
    │   ├── sse.ts              # SSE 客户端封装
    │   └── format.ts           # 格式化工具
    ├── types/
    │   └── index.ts            # TypeScript 类型定义
    └── styles/
        └── global.css          # 全局样式
```

## 5. 页面设计

### 5.1 智能问答页（QaView.vue）

- 布局：左侧 240px 对话列表 + 右侧对话区域
- 交互：输入问题 → 显示用户消息 → mock 流式逐字显示 AI 回答 → 底部溯源卡片
- 组件：ChatMessage（消息气泡）、ChatInput（输入框）、SourceCard（溯源标签）
- Mock：`public/mock/qa-answer.json`，setTimeout 模拟逐字输出

### 5.2 地图交互页（MapView.vue）

- 布局：全屏地图 + 底部工具栏
- 今天：静态占位 + 工具栏按钮
- 后续：OpenLayers 底图 + 矢量图层 + 绘制交互

### 5.3 知识图谱页（GraphView.vue）

- 布局：左侧 220px 筛选面板 + 右侧 G6 画布
- 今天：面板骨架 + SVG 模拟节点/边
- 后续：AntV G6 真实渲染 + 拖拽/缩放

### 5.4 后台管理页（AdminView.vue）

- 布局：统计卡片 + Tab 切换 + el-table 表格
- 今天：文档管理 Tab（mock 数据表格）+ 上传按钮占位
- 后续：实体管理、检索配置、问答日志 Tab

## 6. API 层设计

### 6.1 axios 封装（request.ts）

```typescript
// baseURL: import.meta.env.VITE_API_BASE || '/api'
// 请求拦截器：注入 Authorization: Bearer <token>
// 响应拦截器：401 跳登录，统一错误提示
```

### 6.2 接口定义

| 文件 | 接口 | 方法 | Mock 文件 |
|------|------|------|-----------|
| qa.ts | ask(question) | POST /api/qa/ask (SSE) | qa-answer.json |
| qa.ts | getHistory() | GET /api/qa/history | qa-history.json |
| doc.ts | upload(file) | POST /api/admin/docs/upload | — |
| doc.ts | getDocList() | GET /api/admin/docs | doc-list.json |
| kg.ts | query(params) | GET /api/kg/query | kg-query.json |
| kg.ts | getSubgraph(id) | GET /api/kg/subgraph/:id | kg-subgraph.json |
| spatial.ts | analyze(geojson) | POST /api/spatial/analyze | spatial-result.json |

### 6.3 Mock 策略

- Mock JSON 放在 `public/mock/` 下
- 开发环境 axios 直接 fetch mock 文件
- 后端就绪后改 `request.ts` 的 baseURL 即可切换

## 7. 状态管理

### 7.1 user.ts

```typescript
interface UserState {
  token: string | null
  username: string
  role: 'user' | 'admin'
}
```

### 7.2 qa.ts

```typescript
interface QaState {
  conversations: Conversation[]    // 对话列表
  currentId: string | null         // 当前对话 ID
  messages: Message[]              // 当前对话消息
  loading: boolean                 // 是否正在生成
}
```

## 8. 类型定义（types/index.ts）

```typescript
interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]       // 溯源信息
  timestamp: number
}

interface Source {
  docId: number
  docTitle: string
  page: number
  snippet: string
}

interface Conversation {
  id: string
  title: string
  createdAt: number
}

interface Document {
  docId: number
  title: string
  domain: string
  docType: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  chunkCount: number
  uploadedAt: string
}
```

## 9. 实施顺序

1. Vite 初始化 + 依赖安装
2. 全局布局（App.vue + 侧边栏 + 路由）
3. axios 封装 + mock JSON 文件
4. 类型定义 + Pinia stores
5. 智能问答页（核心页面）
6. 后台管理页
7. 知识图谱页
8. 地图交互页
9. 工具函数（SSE、格式化）
