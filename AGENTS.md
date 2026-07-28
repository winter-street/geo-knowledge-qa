# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目概述

地质找矿智能问答系统（Geo-Knowledge Q&A）—— 基于 RAG + 知识图谱双路检索的智能问答系统。对地质调查报告、区域地质文献做切片向量化，结合 Neo4j 地质知识图谱（岩石-构造-矿产-地质年代）增强上下文，调用 LLM 生成回答，并在地图上标注矿产/构造空间位置。

- **团队**：3 人（A 前端、B Node.js 后端、C Python 预处理）
- **当前状态**：全链路集成联调完成，双路检索+JWT+SSE流式输出均已可用。地质找矿 Schema（Mineral/Rock/Structure/TimePeriod/DepositType）已切换完成，7 篇地质 PDF 入库（1079 chunks），Neo4j 地质实体图谱就绪。空间数据图层（地质矢量图 GeoJSON）开发中

## 常用命令

### 一键启动（开发环境）

```sh
python start_all.py     # 启动 Flask :5000 + 打开开发面板 dashboard
```

### 前端（`frontend/` 目录）

```sh
cd frontend
cp .env.example .env   # 首次：编辑 .env 填入高德地图 Key
npm run dev          # Vite dev server → localhost:5173（/api 代理到 :3000）
npm run build        # vue-tsc 类型检查 + Vite 打包
npm run type-check   # 仅 vue-tsc 类型检查（等同 vue-tsc --build）
npm run preview      # 预览生产构建
```

前端没有 Vitest/Jest 测试运行器。现有的 `utils/*.test.ts` 文件是纯 TypeScript 断言文件（`tsx src/utils/markdown.test.ts` 直接运行）。

### 后端（`backend/` 目录）

```sh
cd backend
cp .env.example .env   # 首次：编辑 .env 填入 DEEPSEEK_API_KEY + NEO4J_PASSWORD
npm install
npm run dev             # tsx watch → localhost:3000
npm run build           # tsc → dist/
npm start               # node dist/index.js（生产）
```

### Python 预处理 & 检索微服务（`ml-service/` 目录）

```sh
cd ml-service
cp config.example.py config.py   # 首次：编辑 config.py 填入 API Key + Neo4j 密码
pip install -r requirements.txt

# 全量预处理管线（PDF → SQLite + TF-IDF + Neo4j，答辩前预跑一次即可）
python scripts/run_pipeline.py

# 启动检索微服务（后端 RAG+KG 依赖此服务）
python server.py          # Flask → localhost:5000
# 开发面板: http://localhost:5000/dashboard

# 单脚本测试
python test_parse_pdf.py
python test_chunk.py
python test_build_index.py
python test_extract_concepts.py
python test_extract_landuse.py
python test_write_neo4j.py
```

- BERT-NER 微调脚本: `python scripts/train_ner.py`
- NER 评估: `python scripts/eval_ner.py`
- OWL 知识图谱构建: `python scripts/build_ontology.py`
- OWL 推理: `python scripts/run_reasoning.py`
- 向量化模型: bge-small-zh-v1.5 (dim=512)，`RETRIEVAL_MODE=bge|tfidf` 降级开关
- NER 实体类型: `Mineral`（矿产）/ `Rock`（岩石）/ `Structure`（构造）/ `TimePeriod`（地质年代）/ `DepositType`（成因类型）
- Neo4j 节点类型: `Document`/`Mineral`/`Rock`/`Structure`/`TimePeriod`/`DepositType`/`Region`（空间区域）
- NER 标注三条路线（均已跑通）：① LLM BIO 直出（`ner_annotate.py`）② LLM JSON→程序转 BIO（备份 `ner_llm_backup.conll`）③ **词典正则扫描**（`dict_ner_geology.py`，Neo4j 实体 + 硬编码 300+ 词，最终方案）
- PDF 文本缓存：`output/parsed_texts.json`（避免重复调用 pdfplumber）
- `run_pipeline.py` 支持 `--from-step4` 跳过 Steps 1-3，从已有 SQLite 重建并重跑实体抽取+Neo4j 写入

### Neo4j

```sh
cd D:\neo4j-community-5.26.4-windows\neo4j-community-5.26.4\bin
neo4j.bat console     # → Browser :7474, Bolt :7687
```

### 开发启动顺序

三个服务**必须同时运行**才能完成完整问答链路：

```sh
# 1. Neo4j（先启动，端口 7687/7474）
neo4j.bat console

# 2. Flask 检索微服务（:5000，后端依赖此服务做 RAG + KG）
cd ml-service && python server.py

# 3. Node.js 后端（:3000）
cd backend && npm run dev

# 4. 前端（:5173，最后启动）
cd frontend && npm run dev
```

Flask :5000 是后端的**运行时依赖** — 若未启动，`/api/qa/ask` 将返回空检索结果。Neo4j 同理，KG 路径依赖其在线。

根目录 `package.json` 仅作为工作区占位，无实际脚本。

## 技术架构

| 层 | 语言 | 框架/库 | 端口 |
|----|------|---------|------|
| 前端 | TypeScript | Vue 3 + Vite + Element Plus + Pinia + Vue Router (hash 模式) + ECharts + AntV G6 | :5173 |
| 后端 | TypeScript | Node.js + Express 4 + neo4j-driver + better-sqlite3 + JWT + multer | :3000 |
| 检索微服务 | Python 3.10+ | Flask + jieba + scikit-learn + joblib + bge | :5000 |
| 预处理 | Python 3.10+ | pdfplumber + jieba + scikit-learn + neo4j + BERT-NER | 离线脚本 |
| 向量存储 | SQLite + TF-IDF / BGE 语义向量（可切换） | — |
| 图数据库 | Neo4j Community 5.26.4 | :7474 (Browser) / :7687 (Bolt) |
| LLM | DeepSeek Chat（OpenAI 兼容 SDK，主）+ 通义千问（备用） | HTTPS |
| 本体推理 | OWL (owlready2) | 离线 |

### 问答全链路数据流

```
用户问题 → 前端地图交互 / 问答输入
          ↓
    后端 Express :3000 (JWT 鉴权)
          ↓ (Promise.all 并行)
   ┌─────────┴──────────────┐
   │ RAG 检索路径            │ KG 知识路径
   │ POST :5000/search       │ Neo4j 多跳查询
   │ → bge/TF-IDF 语义检索   │ → 岩石-矿产-构造关系
   │ → SQLite Top-K          │ → 成矿线索链
   └─────────┬──────────────┘
             ↓
      LLM Gateway (DeepSeek主，通义千问答备)
             ↓
   ┌─────────┴──────────────┐
   │ 文字回答               │ 地图标注
   │ → 地学知识回答          │ → 矿产/构造点位显示
   │ → SourceCard 引用       │ → 知识关联可视化
   └────────────────────────┘
```

#### 核心问答路由 (`POST /api/qa/ask`) 详细流程

**步骤 1 — 并行三路检索**：`Promise.all([tfidf.search(), kg.searchEntities(), kg.getSpatialResults()])`

**步骤 2 — 空间数据降级**：若 Neo4j 未返回坐标数据，回退到 `matchMockSpatial(question)`（基于关键词的硬编码模拟数据）

**步骤 3 — 低相关性关守**：TF-IDF top-1 得分 < 0.04 且 KG 无结果 → 返回问候语，绕过 LLM

**步骤 4a — 流式模式 (SSE)**：
- 设置 SSE 响应头（`text/event-stream`、`no-cache`、`X-Accel-Buffering: no`）
- 先发 `meta` 事件（`ragCount`、`kgCount`、`spatialCount`、`kgContext`）
- 调用 `generateAnswerStream()`，`onChunk` → `{ type: "chunk", content }`，`onDone` → 写 SQLite 日志 + `{ type: "done", sources, kgContext, spatialData }`，`onError` → `{ type: "error", message }`

**步骤 4b — 普通模式**：调用 `generateAnswer()`，返回 JSON `{ answer, sources, kgContext, spatialData }`

每次问答记入 SQLite `qa_logs` 表（`id`、`question`、`pathUsed`、`hitDocs`、`latency`）

### 数据处理管线

| 阶段 | 输入 | 处理 | 输出 |
|------|------|------|------|
| **地学文档处理** | PDF地质报告 | chunk_text.py 切分 → embed_chunks.py bge 编码 | SQLite chunks + TF-IDF 模型 |
| **本体构建** | 地学术语/类别 | build_ontology.py → OWL 定义 | geo_planning.owl |
| **NER 标注** | CoNLL-2003 格式 | 词典标注（dict_ner_geology.py）→ BERT-NER 微调 → eval_ner.py 评估 | ner_final.conll |
| **知识图谱** | 地质报告文本 | extract_concepts.py + write_neo4j.py | Neo4j 实体+关系 |
| **推理增强** | 用户问题 | run_reasoning.py OWL 推理 | 成矿知识线索 |

RAG 检索通过 HTTP 调用 Flask 微服务，KG 检索由后端 `neo4j-driver` 直连 Neo4j。LLM 调用通过 Gateway 支持多模型调度和异常互备。

## 后端架构

```
backend/src/
├── config.ts              # dotenv 加载 + AppConfig 类型校验
├── index.ts               # Express 启动入口：CORS、JWT中间件、路由挂载
├── middleware/
│   └── auth.ts            # JWT 签发/验证中间件
├── routes/
│   ├── qa.ts              # POST /api/qa/ask — 双路检索 + LLM (支持 SSE流式)
│   ├── kg.ts              # GET /api/kg/subgraph — 图可视化数据
│   ├── admin.ts           # GET /api/admin/docs — 文档列表 & 统计
│   ├── auth.ts            # POST /api/auth/login（JWT 登录, bcrypt校验）
│   └── upload.ts          # POST /api/admin/docs/upload（multer PDF 上传, 50MB）
├── services/
│   ├── llm.ts             # LLM Gateway 入口（注册 Provider）
│   ├── llm/
│   │   ├── provider.ts    # LLMProvider 接口
│   │   ├── deepseek.ts    # DeepSeek Provider（OpenAI SDK）
│   │   ├── tongyi.ts      # 通义千问 Provider（占位，填key即激活）
│   │   └── gateway.ts     # 多模型调度 + 异常互备
│   ├── tfidf.ts           # Flask 微服务 HTTP 客户端
│   ├── kg.ts              # Neo4j 客户端（地质实体搜索: 矿产/岩石/构造/年代 + 子图查询）
│   └── tokenizer.ts       # nodejieba 中文分词
├── db/
│   └── sqlite.ts          # SQLite 数据层（读 ml-service/output/geo_knowledge.db + 管理 qa_logs 表）
└── types/index.ts         # 共享 TS 类型
```

- Express 4.x，ESM 模块（`"type": "module"`）
- 开发用 `tsx watch` 热重载
- JWT 鉴权：`authMiddleware` 保护除 `/api/auth/login` 和 `/api/health` 外的所有路由
- CORS 开发阶段开放 localhost:5173（多来源）和 :5000（dashboard）
- `db/sqlite.ts` 直接读取 Python 管线产出的 `ml-service/output/geo_knowledge.db`，同时管理 `qa_logs` 表（问答日志）和统计查询

#### LLM Gateway — 多模型调度 + 异常互备

单例 `LLMGateway`（`gateway` 实例导出），维护有序的 `LLMProvider[]` 列表。注册顺序即优先级：
1. `DeepSeekProvider`（主模型）
2. `TongyiProvider`（备用，仅 API key 已配置时激活）

**非流式 (`generateAnswer`)**：按优先级遍历 provider，可重试错误（timeout/ECONNREFUSED/429/rate limit）自动切换下一个；全部失败 → `mockAnswer()` 降级

**流式 (`generateAnswerStream`)**：仅用主 provider，不跨 provider 故障转移；失败 → 降级到 mockAnswer（整段文本作为单 chunk 发出后 `onDone`）

**Mock 降级**：格式化原始检索结果 + "LLM 服务暂不可用"提示 + 前 5 个文档片段作为来源

#### LLM Provider

`LLMProvider` 接口定义 `generateAnswer()` 和 `generateAnswerStream()` 两个方法，均接收 `(question, ragChunks, kgContext, systemPrompt, userPrompt)`。Provider 实际上只使用预构建的 `systemPrompt` + `userPrompt`，`question`/`ragChunks`/`kgContext` 保留用于未来扩展。

- **DeepSeekProvider**：OpenAI 兼容 SDK，`temperature: 0.3, max_tokens: 2048`，非流式 30s 超时、流式 60s 超时，来源从 `_ragChunks` 直接构建（snippet 取前 150 字符）
- **TongyiProvider**：与 DeepSeek 结构相同，指向 `dashscope.aliyuncs.com/compatible-mode/v1`，代码标注为"占位实现"
- 支持模型：`deepseek-chat` / `deepseek-v4-flash` / `deepseek-v4-pro`，`qwen-plus` / `qwen-max` / `qwen-turbo`（均通过环境变量可配置）

#### Prompt 构建 (`llm.ts`)

**系统提示词**（约 350 字）：地质领域专用，关键指令 — ① 基于上下文回答，信息不完整也给出已有线索，不说"未收录" ② 确实无信息才说未收录 ③ 闲聊友好回应并引导地质问题 ④ 提及空间位置 ⑤ 末尾列出关键地质实体便于地图标注

**用户提示词 (`buildPrompt`)**：组装 RAG 片段（`[文档片段 N]（来源：《标题》第X页，相关度: XX%）`）+ KG 路径（`「实体」—[关系]→「实体」`）+ 6 条格式要求

#### Neo4j KG 服务（地质 Schema）

6 种节点类型：`Mineral` / `Rock` / `Structure` / `TimePeriod` / `DepositType` / `Region`

8 种关系类型：`HOSTED_IN` / `CONTROLLED_BY` / `FORMED_IN` / `BELONGS_TO` / `LIES_IN` / `ASSOCIATED_WITH` / `CUTS` / `REFERENCES`

- **`searchEntities(question)`**：分词取关键词（≥2 字，最多 5 个），Cypher `MATCH (n)-[r]->(m) WHERE n.name CONTAINS $kw`，去重最多 10 条 → `KGPath[]`
- **`getSubgraph(query, depth=2)`**：多跳展开，排除 Document 节点 → `{ nodes: GraphNode[], edges: GraphEdge[] }`
- **`getSpatialResults(question)`**：查询带 `lng`/`lat` 的节点 → `GeoPoint[]`；查询带 `path` 的节点（JSON 数组或 Neo4j Point 列表）→ `GeoPolyline[]`
- **CRUD**：`getEntityDetail()` / `updateEntity()` / `deleteEntity()` / `getEntityStats()`

#### TF-IDF 检索服务

HTTP 客户端调用 Flask `:5000/search`，`search(query, topK)` → 映射 `c.text → chunk.content`，错误静默返回 `[]`。`toSources(results)` 转前端 `Source[]` 格式（snippet 取前 120 字符）

## 前端架构

### 双布局 + 角色路由

前端按角色分为两套独立布局，由路由嵌套实现：

**普通用户（`/user/*`）**：`UserLayout.vue` — 顶部水平导航栏 + 品牌区 + `<router-view>`
- `/user/qa` — 智能问答
- `/user/map` — 地图交互
- `/user/graph` — 知识图谱

**管理员（`/admin/*`）**：`AdminLayout.vue` — 可折叠侧边栏（56px/200px）+ 顶栏 + `<router-view>`
- `/admin/console` — 知识库管理（统计卡片 + 文档表格 + ECharts 图表）
- `/admin/qa` — 智能问答
- `/admin/map` — 地图交互
- `/admin/graph` — 知识图谱

**路由守卫**（`router/index.ts` `beforeEach`）：
- 无 token → 重定向到 `/login`
- 有 token 但 role 不匹配 → 重定向到该角色首页
- 有 token 且访问 `/login` → 重定向到角色首页
- Token 和 role 存储在 `localStorage`

### 自动导入

`unplugin-auto-import` 自动导入 `vue`、`vue-router`、`pinia` —— `.vue` 的 `<script setup>` 中无需手动 `import { ref, computed }` 等。

`unplugin-vue-components` + Element Plus 解析器自动注册组件 —— 无需手动导入 `<el-button>` 等。

### 前端文件结构

```
frontend/src/
├── main.ts                     # createApp + Pinia + Router
├── App.vue                     # 根组件（仅 <router-view>）
├── api/
│   ├── request.ts              # axios 实例（baseURL: /api, token拦截器, 401处理）
│   ├── auth.ts                 # 登录/登出 API
│   ├── qa.ts                   # 问答接口（dev mock 优先）
│   ├── doc.ts                  # 文档列表接口
│   └── kg.ts                   # 知识图谱子图接口
├── layouts/
│   ├── AdminLayout.vue         # 管理员布局：可折叠侧边栏
│   └── UserLayout.vue          # 普通用户布局：顶部导航
├── views/
│   ├── LoginView.vue           # 登录页（角色选择 + token 签发）
│   ├── QaView.vue              # 智能问答页：对话列表 + 消息区 + 内嵌高德地图面板（空间标注渲染 + 图层切换 + 文字兜底）
│   ├── MapView.vue             # 地图交互页（高德 JSAPI v2.0 + 绘制/底图切换 + 空间图层叠加）
│   ├── GraphView.vue           # 知识图谱页（G6 力导向图 + 筛选面板）
│   └── AdminView.vue           # 管理控制台（统计卡片 + 文档表格 + ChartPanel 图表）
├── components/
│   ├── ChatMessage.vue         # 单条聊天消息：Markdown 渲染 + SourceCard 引用 + KG 关系标签 + 地图查看入口
│   ├── ChatInput.vue           # 输入框（Enter 发送）
│   ├── SourceCard.vue          # 溯源卡片（文档标题 + 页码）
│   ├── StatCard.vue            # 统计卡片（label + value + unit）
│   └── ChartPanel.vue          # ECharts 图表容器（vue-echarts 封装）
├── stores/
│   ├── user.ts                 # token + username + role
│   └── qa.ts                   # 对话列表 + 消息 + sendMessage()
├── router/
│   └── index.ts                # 路由表（/user/*, /admin/*, /login）+ 角色守卫
├── types/
│   └── index.ts                # Message, Source, Conversation, Document 等类型
├── utils/
│   ├── format.ts               # formatTime 等格式化工具
│   ├── markdown.ts             # Markdown 渲染（含 .test.ts）
│   ├── search.ts               # 前端搜索工具（含 .test.ts）
│   └── spatial.ts              # 空间数据处理工具
└── styles/
    └── global.css              # 设计 Token（CSS 自定义属性）
```

### 前端测试

`utils/markdown.test.ts` 和 `utils/search.test.ts` 是纯 TypeScript 断言文件，用 `npx tsx src/utils/xxx.test.ts` 直接运行，输出断言通过/失败信息。无 Vitest 配置。

### 设计系统："Policy Journal"

温暖、权威的编辑风格，参考政府研究出版物和学术期刊。**所有视觉决策以 [frontend/DESIGN.md](frontend/DESIGN.md) 为准。**

- **字体**：Source Serif 4（标题展示，`--font-display`）+ Inter（正文，`--font-body`），CJK 回退 PingFang SC / Microsoft YaHei
- **色彩**：暖灰 Ink 色阶 `#1A1A2E` → `#F0EDE5` + 森林绿主色 `#2E7D5B` + 机构蓝强调色 `#1E3A5F`
- **圆角**：最大 6px（`--radius-lg`），禁止胶囊形
- **阴影**：极简 `sm`/`md`，无彩色阴影/发光
- **按钮**：纯色背景，无渐变/无 translateY hover
- 设计 Token 定义在 [styles/global.css](frontend/src/styles/global.css)，覆盖 Element Plus 的 `--el-*` 变量

## 重要约定

- **CSS**：所有样式使用 `<style scoped>`，不使用预处理器。设计 Token 为 CSS 自定义属性，在 `global.css` 中定义，组件内直接引用。
- **TypeScript 类型**：前端共享类型定义在 `types/index.ts`，后端在 `backend/src/types/index.ts`，不要在各模块中重复定义。
- **路径别名**：前端 `@` → `frontend/src/`（Vite 配置）。
- **中文排版**：使用「」引号，中文正文 `letter-spacing: 0.02em`。
- **禁止项**（见 DESIGN.md 反模式清单）：紫色渐变、渐变色球、Inter 做标题字体、Emoji 做图标、`translateY` hover 效果、胶囊按钮、彩色阴影。
- **LLM 交互**：见 [scripts/chat.md](scripts/chat.md)（中文回答、结构化输出、九锁协议）。
- **领域术语**：见 [CONTEXT.md](CONTEXT.md)（Chunk / KG Path / 双路检索 / 地质实体 Schema 等定义）。
- **实施计划**：见 [docs/项目修改计划-地质找矿方向.md](docs/项目修改计划-地质找矿方向.md)（4 阶段 × 详细任务分解）。
- **Vite 代理**：`/api` 代理到 `http://localhost:3000`，前端开发无需配置 baseURL。
- **敏感文件**：`ml-service/config.py`（含真实 API Key/密码）在 `.gitignore` 中，切勿提交。

## 关键文件

| 文件 | 用途 |
|------|------|
| `frontend/src/layouts/AdminLayout.vue` | 管理员布局：可折叠侧边栏 + 顶栏 |
| `frontend/src/layouts/UserLayout.vue` | 普通用户布局：顶部水平导航 |
| `frontend/src/router/index.ts` | 路由表 + 角色守卫（user/admin 双重鉴权） |
| `frontend/src/views/LoginView.vue` | 登录页（角色选择 + JWT 签发） |
| `frontend/src/views/QaView.vue` | 问答页：对话列表 + 消息区 + 内嵌高德地图（标记点/断裂线渲染 + 图层切换 + 无key文字兜底） |
| `frontend/src/api/request.ts` | axios 实例：baseURL、token 拦截器、401 处理 |
| `frontend/src/api/qa.ts` | 问答 API：`askQuestion()` JSON模式 + `askQuestionStream()` SSE流式（Fetch手动解析，dev直连 :3000 绕过代理缓冲） |
| `frontend/src/stores/qa.ts` | 问答 Store：对话CRUD + `sendMessageStream()` 流式消息补丁 + localStorage 持久化 |
| `frontend/src/components/ChatMessage.vue` | 聊天消息：Markdown渲染 + SourceCard引用 + KG标签 + 地图查看入口 |
| `frontend/src/types/index.ts` | 前端类型：`Message`(含 sources/kgContext/spatialData) + `QaAskResponse` + `SpatialData` |
| `frontend/vite.config.ts` | Vite 配置：插件、别名、自动导入、`/api` 代理到 :3000 |
| `frontend/DESIGN.md` | 视觉设计规范（所有样式改动的权威参考） |
| `frontend/src/styles/global.css` | 设计 Token（CSS 自定义属性 + Element Plus 覆盖） |
| `backend/src/index.ts` | Express 启动：中间件、路由、bootstrap 流程 |
| `backend/src/config.ts` | 环境变量加载 + 配置对象 |
| `backend/src/routes/qa.ts` | 核心问答路由：三路并行检索（RAG+KG+空间）→ LLM，支持 SSE 流式(meta→chunk→done)和普通JSON |
| `backend/src/routes/upload.ts` | PDF 上传路由（multer，存 backend/uploads/） |
| `backend/src/services/llm.ts` | LLM 入口：Provider 注册 + SYSTEM_PROMPT(350字地质专用) + buildPrompt(RAG+KG上下文组装) |
| `backend/src/services/llm/gateway.ts` | LLM Gateway：多模型优先级调度 + 异常互备 + mock降级 |
| `backend/src/services/llm/deepseek.ts` | DeepSeek Provider（OpenAI SDK，temperature=0.3，非流式30s/流式60s超时） |
| `backend/src/services/llm/tongyi.ts` | 通义千问 Provider（占位实现，dashscope.aliyuncs.com） |
| `backend/src/services/kg.ts` | Neo4j 客户端：地质实体搜索(Mineral/Rock/Structure/TimePeriod/DepositType) + 子图查询 + 空间坐标查询 + 实体CRUD |
| `backend/src/services/tfidf.ts` | Flask :5000 HTTP 客户端（RAG 检索 + toSources 格式转换） |
| `backend/src/db/sqlite.ts` | SQLite 数据层（读 Python 管线 DB + qa_logs） |
| `backend/src/middleware/auth.ts` | JWT 签发/验证中间件 |
| `ml-service/server.py` | Flask 检索微服务（TF-IDF/BGE 搜索 + 开发面板 dashboard） |
| `ml-service/scripts/run_pipeline.py` | 全量预处理管线入口（支持 `--from-step4` 跳过 Steps 1-3） |
| `ml-service/scripts/dict_ner_geology.py` | 词典标注地质 NER 训练数据（Neo4j 实体 + 硬编码词典 + 正则扫描） |
| `ml-service/scripts/train_ner.py` | BERT-NER 微调脚本 |
| `ml-service/scripts/eval_ner.py` | NER 评估脚本（seqeval，主力类 Mineral+Rock F1） |
| `ml-service/scripts/finish_c2_c1.py` | C-2 收尾 + C-1 补齐：清理 Neo4j 脏节点 |
| `ml-service/scripts/build_ontology.py` | OWL 知识图谱构建 |
| `ml-service/scripts/run_reasoning.py` | OWL 推理脚本 |
| `ml-service/config.example.py` | Python 配置模板（复制为 config.py 填入真实值） |
| `start_all.py` | 一键启动器（Flask + 浏览器打开开发面板） |
| `docs/项目修改计划-地质找矿方向.md` | 地质找矿方向项目修改计划（4 阶段 × 任务分解） |
| `CONTEXT.md` | 领域术语表（Chunk / KG Path / 双路检索 / 地质实体 Schema 等） |
| `plans/5day-plan.md` | 终期汇报 5 天推进计划（7/9→7/14），A/B/C 每日任务分解 |
| `plans/mining-app-timeline.md` | 地质找矿 ABC 任务安排 + 联调里程碑 |
| `scripts/chat.md` | LLM 交互准则（中文、结构化输出、九锁协议） |
