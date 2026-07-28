# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

地质找矿智能问答系统（Geo-Knowledge Q&A）—— 基于 RAG + 知识图谱双路检索的智能问答系统。对地质调查报告、区域地质文献做切片向量化，结合 Neo4j 地质知识图谱（岩石-构造-矿产-地质年代）增强上下文，调用 LLM 生成回答，并在地图上标注矿产/构造空间位置。支持成矿预测网格计算与空间分析。

- **团队**：3 人（A 前端、B Node.js 后端、C Python 预处理）
- **当前状态**：全链路集成联调完成。地质找矿 Schema 已切换，7 篇地质 PDF 入库（1079 chunks），Neo4j 地质实体图谱就绪。空间功能（问答→地图联动、成矿预测网格、时空分析）已开发完成。GeoJSON 矢量图层仍待 C 同学产出数据后接入。

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
npm run type-check   # 仅 vue-tsc 类型检查
npm run preview      # 预览生产构建
npx tsx src/utils/xxx.test.ts   # 运行纯 TypeScript 断言测试
```

后端同理：
```sh
cd backend
cp .env.example .env
npx tsx src/services/xxx.test.ts   # 运行后端断言测试
```

前端没有 Vitest/Jest 测试运行器。所有 `*.test.ts` 文件是纯 TypeScript 断言文件，用 `tsx` 直接运行。

### 后端（`backend/` 目录）

```sh
cd backend
cp .env.example .env   # 首次：填入 DEEPSEEK_API_KEY + NEO4J_PASSWORD
npm install
npm run dev             # tsx watch → localhost:3000
npm run build           # tsc → dist/
npm start               # node dist/index.js（生产）
```

### Python 预处理 & 检索微服务（`ml-service/` 目录）

```sh
cd ml-service
cp config.example.py config.py   # 首次：填入 API Key + Neo4j 密码
pip install -r requirements.txt

# 全量预处理管线（PDF → SQLite + TF-IDF + Neo4j）
python scripts/run_pipeline.py

# 从已有 SQLite 重建，跳过 Steps 1-3
python scripts/run_pipeline.py --from-step4

# 启动检索微服务
python server.py          # Flask → localhost:5000
# 开发面板: http://localhost:5000/dashboard

# NER 微调 & 评估
python scripts/train_ner.py
python scripts/eval_ner.py

# OWL 推理
python scripts/build_ontology.py
python scripts/run_reasoning.py

# 单脚本测试
python test_parse_pdf.py
python test_chunk.py
python test_build_index.py
python test_extract_concepts.py
python test_write_neo4j.py
```

- 向量化模型: bge-small-zh-v1.5 (dim=512)，`RETRIEVAL_MODE=bge|tfidf` 降级开关
- NER 实体类型: `Mineral`/`Rock`/`Structure`/`TimePeriod`/`DepositType`
- Neo4j 节点类型: `Document`/`Mineral`/`Rock`/`Structure`/`TimePeriod`/`DepositType`/`Region`
- NER 标注最终方案：**词典正则扫描**（`dict_ner_geology.py`，Neo4j 实体 + 硬编码 300+ 词）
- BERT-NER 备选路线（学术用途，主流程未使用 BERT 路径）
- PDF 文本缓存：`output/parsed_texts.json`
- pipeline 产出的 BERT-NER 模型在 `models/bert-ner/`

### Neo4j

```sh
cd D:\neo4j-community-5.26.4-windows\neo4j-community-5.26.4\bin
neo4j.bat console     # → Browser :7474, Bolt :7687
```

### Docker（可选）

```sh
cd docker
# neo4j / nginx / postgres 的 docker-compose 配置在此
docker compose up -d
```

### 开发启动顺序

四个服务**必须同时运行**才能完成完整问答链路：

```sh
# 1. Neo4j（先启动，端口 7687/7474）
neo4j.bat console

# 2. Flask 检索微服务（:5000）
cd ml-service && python server.py

# 3. Node.js 后端（:3000）
cd backend && npm run dev

# 4. 前端（:5173）
cd frontend && npm run dev
```

Flask :5000 是后端**运行时依赖** — 未启动则 `/api/qa/ask` 返回空检索结果。

根目录 `package.json` 仅工作区占位，无实际脚本。

## 技术架构

| 层 | 语言 | 框架/库 | 端口 |
|----|------|---------|------|
| 前端 | TypeScript | Vue 3 + Vite + Element Plus + Pinia + Vue Router (hash) + ECharts + AntV G6 + AMap JSAPI v2.0 | :5173 |
| 后端 | TypeScript | Express 4 + neo4j-driver + better-sqlite3 + JWT + multer + nodejieba + openai SDK + @turf/turf | :3000 |
| 检索微服务 | Python | Flask + jieba + scikit-learn + joblib + bge | :5000 |
| 预处理 | Python | pdfplumber + jieba + neo4j + BERT-NER + owlready2 | 离线 |
| 向量存储 | SQLite + TF-IDF / BGE 语义向量（可切换） | — |
| 图数据库 | Neo4j Community 5.26.4 | :7474 (Browser) / :7687 (Bolt) |
| LLM | DeepSeek Chat（OpenAI 兼容 SDK，主）+ 通义千问（备用） | HTTPS |
| 部署 | Docker Compose | neo4j + nginx + postgres | — |

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
   │ → 重排 + 融合           │ → 成矿线索链
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

**步骤 1 — 并行三路检索**：`tfidf.search()` + `kg.searchEntities()` + `kg.getSpatialResults()`

**步骤 2 — RAG 重排**：`rag-reranker.ts` 对 RAG 片段做重排序

**步骤 3 — 双路融合**：`retrieval-fusion.ts` 融合 RAG + KG 结果

**步骤 4 — 低相关性关守**：TF-IDF top-1 < 0.04 且 KG 无结果 → 返回问候语绕过 LLM

**步骤 5a — 流式模式 (SSE)**：先发 `meta` 事件 → `chunk` → `done`（写 SQLite 日志 + sources/spatialData）

**步骤 5b — 普通模式**：返回 JSON `{ answer, sources, kgContext, spatialData }`

每次问答记入 SQLite `qa_logs` 表。

### 运行时检索配置

系统支持动态调整检索策略（非硬编码）：

- **API**：`GET/PUT /api/admin/retrieval-config`
- **配置项**：RAG/KG/空间是否启用、权重比例、TopK、LLM 模型参数
- **能力检测**：自动检测 bge/tfidf/kg/spatial 可用性与 BERT/OWL 离线状态
- **实现**：`runtime-settings.ts` + `retrieval-policy.ts`

### 空间分析功能

**API**：`POST /api/spatial/query` — 按关键词/实体类型/bbox/center/radiusKm 联合查询

**成矿预测网格**：`POST /api/spatial/grid` — 5km/10km/20km 网格，基于距断裂距离、本体匹配度、岩性密度计算综合评分

**数据结构**：
- `ProspectivityGridCell` — 含 score/level/factors/pointCount
- `SpatialAnalysis` — interpretation + temporal + regions + warnings
- `MapPlan` — 一系列 MapAction 串联执行（query/filter/buffer/heatmap/timeline/grid-prediction）

### 数据处理管线

| 阶段 | 输入 | 处理 | 输出 |
|------|------|------|------|
| **PDF 解析** | 地质报告 PDF | parse_pdf.py → chunk_text.py | SQLite chunks + 文本缓存 |
| **向量化** | text chunks | embed_chunks.py (bge) + build_index.py (TF-IDF) | bge 向量 + TF-IDF 模型 |
| **概念抽取** | 文本 | extract_concepts.py / extract_landuse.py / extract_glossary.py / extract_hybrid.py | 实体 + 术语 |
| **NER 标注** | CoNLL-2003 格式 | dict_ner_geology.py (词典+正则，300+ 词) | BIO 标注 |
| **BERT-NER** | 标注数据 | train_ner.py → eval_ner.py | bert-ner 模型（学术用途） |
| **知识图谱** | 实体 | write_neo4j.py | Neo4j 节点+关系 |
| **OWL 本体** | 类别定义 | build_ontology.py | geo_planning.owl |
| **OWL 推理** | OWL + 知识图谱 | run_reasoning.py | 推断关系 |

## 后端架构

```
backend/src/
├── config.ts              # dotenv + AppConfig 类型校验
├── index.ts               # Express 启动：CORS、JWT、路由挂载
├── middleware/
│   └── auth.ts            # JWT 签发/验证中间件
├── routes/
│   ├── qa.ts              # POST /api/qa/ask — 三路并行检索 + LLM，SSE 流式
│   ├── kg.ts              # GET /api/kg/subgraph — 子图可视化
│   ├── admin.ts           # GET /api/admin/docs — 文档管理
│   ├── auth.ts            # POST /api/auth/login
│   ├── upload.ts          # POST /api/admin/docs/upload — PDF 上传 (50MB)
│   └── spatial.ts         # POST /api/spatial/query + /grid — 空间查询 + 成矿网格
├── data/
│   └── spatial-mock.ts    # 空间模拟数据（7 个真实锚点 + 断裂线）
├── services/
│   ├── llm.ts             # LLM Gateway 入口 + SYSTEM_PROMPT + buildPrompt
│   ├── llm/
│   │   ├── provider.ts    # LLMProvider 接口
│   │   ├── gateway.ts     # 多模型优先级调度 + 异常互备 + mock降级
│   │   ├── deepseek.ts    # DeepSeek Provider (OpenAI SDK)
│   │   └── tongyi.ts      # 通义千问 Provider（占位，填key即激活）
│   ├── tfidf.ts           # Flask :5000 HTTP 客户端
│   ├── kg.ts              # Neo4j 客户端（6 种节点 × 8 种关系）
│   ├── kg-query.ts        # KG 查询编排
│   ├── kg-query-analysis.ts  # KG 查询意图分析
│   ├── kg-ranking.ts      # KG 结果排序 + 打分原因
│   ├── tokenizer.ts       # nodejieba 中文分词
│   ├── spatial.ts         # 空间查询分析（坐标映射、意图解析）
│   ├── spatial-query.ts   # 空间查询逻辑
│   ├── rag-reranker.ts    # RAG 结果重排
│   ├── retrieval-fusion.ts    # RAG+KG 双路融合
│   ├── retrieval-policy.ts    # 检索策略控制
│   ├── retrieval-status.ts    # 检索能力追踪
│   ├── runtime-settings.ts    # 运行时检索配置读写
│   ├── map-plan.ts        # 地图规划 action 序列
│   └── prospectivity-grid.ts  # 成矿预测网格计算
├── db/
│   └── sqlite.ts          # SQLite 数据层（读 Python DB + qa_logs）
└── types/index.ts         # 共享 TS 类型
```

### LLM Gateway

单例 `LLMGateway`，注册顺序即优先级：
1. `DeepSeekProvider`（主）— temp=0.3, max_tokens=2048, 非流式 30s / 流式 60s 超时
2. `TongyiProvider`（备用，dashscope.aliyuncs.com）

非流式：错误时重试并切换下一个 provider；全部失败 → `mockAnswer()` 降级
流式：仅用主 provider，失败 → mockAnswer

### Neo4j KG 服务

6 种节点：`Mineral` / `Rock` / `Structure` / `TimePeriod` / `DepositType` / `Region`
8 种关系：`HOSTED_IN` / `CONTROLLED_BY` / `FORMED_IN` / `BELONGS_TO` / `LIES_IN` / `ASSOCIATED_WITH` / `CUTS` / `REFERENCES`

- `searchEntities(question)` — 分词取关键词 → Cypher CONTAINS 查询，去重最多 10 条
- `getSubgraph(query, depth=2)` — 多跳展开，排除 Document
- `getSpatialResults(question)` — 查 lng/lat/path → GeoPoint[] / GeoPolyline[]
- CRUD: `getEntityDetail()` / `updateEntity()` / `deleteEntity()` / `getEntityStats()`

### 关键规则

- **低相关性关守**：TF-IDF top-1 < 0.04 且 KG 空 → 问候语绕过 LLM
- **空间降级**：Neo4j 无坐标 → 关键词模拟数据
- **每条问答记录**：SQLite `qa_logs`（question/pathUsed/hitDocs/latency）
- **空间图层暂缺**：`/spatial/layer/:name` 返回 503，等待 C 同学产出 GeoJSON

## 前端架构

### 双布局 + 角色路由

**普通用户（`/user/*`）**：`UserLayout.vue` — 顶部水平导航栏 + `<router-view>`
- `/user/qa` — 智能问答（对话列表 + SSE 流式 + SourceCard + KG 标签 + 内嵌地图面板）
- `/user/map` — 地图交互（AMap WebGL + 底图切换 + 空间图层叠加 + 绘制工具）
- `/user/graph` — 知识图谱（G6 力导向图 + 筛选面板）

**管理员（`/admin/*`）**：`AdminLayout.vue` — 可折叠侧边栏(56px/200px) + 顶栏 + `<router-view>`
- `/admin/console` — 知识库管理（统计卡片 + 文档表格 + ECharts 图表）
- `/admin/qa` — 智能问答
- `/admin/map` — 地图交互
- `/admin/graph` — 知识图谱

**路由守卫**（`router/index.ts` `beforeEach`）：
- 无 token → `/login`
- role 不匹配 → 重定向到该角色首页
- 有 token 访问 `/login` → 重定向到角色首页

### 自动导入

`unplugin-auto-import` 自动导入 `vue`、`vue-router`、`pinia`
`unplugin-vue-components` + Element Plus 解析器自动注册组件

### 前端文件结构

```
frontend/src/
├── main.ts                     # createApp + Pinia + Router
├── App.vue                     # 根组件（仅 <router-view>）
├── api/                        # API 层 (8 个文件)
│   ├── request.ts              # axios 实例（baseURL: /api, token 拦截器, 401 处理）
│   ├── auth.ts                 # 登录/登出
│   ├── qa.ts                   # 问答 API（dev mock + SSE 流式）
│   ├── doc.ts                  # 文档管理
│   ├── kg.ts                   # 知识图谱子图
│   ├── spatial.ts              # 空间数据 API
│   ├── retrieval-config.ts     # 检索策略配置 API
│   └── qa.test.ts              # qa.ts 单元测试
├── layouts/
│   ├── AdminLayout.vue         # 管理员布局：可折叠侧边栏
│   └── UserLayout.vue          # 普通用户布局：顶部导航
├── views/                      # 页面视图 (5 个)
│   ├── LoginView.vue           # 登录页（角色选择 + JWT）
│   ├── QaView.vue              # 智能问答 + 内嵌地图 + 右键菜单 + MapPlan
│   ├── MapView.vue             # 地图交互页（AMap WebGL + 空间图层 + 绘制）
│   ├── GraphView.vue           # 知识图谱页（G6 力导向图）
│   └── AdminView.vue           # 管理控制台（统计 + 文档表格 + ChartPanel）
├── components/                 # 通用组件 (6 个)
│   ├── ChatMessage.vue         # Markdown渲染 + SourceCard + KG标签 + 地图查看入口
│   ├── ChatInput.vue           # 输入框（Enter发送 + IME 229 guard）
│   ├── SourceCard.vue          # 溯源卡片
│   ├── StatCard.vue            # 统计卡片
│   ├── ChartPanel.vue          # ECharts 容器
│   └── KgMiniGraph.vue         # 微型知识图谱子图
├── stores/                     # Pinia stores (3 个)
│   ├── user.ts                 # token + username + role
│   ├── qa.ts                   # 对话CRUD + sendMessageStream() + localStorage持久化
│   └── spatial-task.ts         # 空间任务状态
├── router/
│   └── index.ts                # 路由表 + 角色守卫
├── types/
│   └── index.ts                # Message/KGPath/SpatialData/ProspectivityScore/MapPlan 等
├── utils/                      # 工具函数 (14 个 .ts)
│   ├── format.ts               # formatTime 等格式化工具
│   ├── markdown.ts             # Markdown 渲染
│   ├── search.ts               # 搜索过滤（filterConversations）
│   ├── conversation.ts         # 对话管理
│   ├── spatial.ts              # 空间数据处理（分类颜色/标签/mock预设）
│   ├── spatial-export.ts       # 空间数据导出
│   ├── spatial-temporal.ts     # 时空分析聚合
│   ├── amap.ts                 # 高德地图封装（中国范围约束、安全缩放）
│   ├── owl.ts                  # OWL 本体操作
│   ├── retrieval-config.ts     # 检索策略配置（本地）
│   ├── map-plan.ts             # 地图规划 action 序列
│   ├── prospectivity-grid.ts   # 成矿预测网格（前端展示）
│   ├── kg-evidence.ts          # KG 证据链构建
│   └── kg-graph.ts             # KG 图谱数据处理
└── styles/
    └── global.css              # 设计 Token + Element Plus 覆盖
```

### 前端测试

所有 `.test.ts` 均为纯 TypeScript 断言文件，用 `npx tsx src/utils/xxx.test.ts` 或 `npx tsx backend/src/services/xxx.test.ts` 运行。

### 设计系统："Policy Journal"

温暖、权威的编辑风格。**所有视觉决策以 [frontend/DESIGN.md](frontend/DESIGN.md) 为准。**

- **字体**：Source Serif 4（标题 `--font-display`）+ Inter（正文 `--font-body`），CJK 回退 PingFang SC / Microsoft YaHei
- **色彩**：暖灰 Ink `#1A1A2E` → `#F0EDE5` + 森林绿 `#2E7D5B` + 机构蓝 `#1E3A5F`
- **圆角**：最大 6px（`--radius-lg`），禁止胶囊形
- **阴影**：极简 sm/md，无彩色阴影/发光
- **按钮**：纯色背景，无渐变/无 translateY hover
- **设计演示**：`frontend/design-demos/` 下有 v1-notion-pure、v2-policy-journal（选中）、v3-wabi-sabi 三种原型

## 重要约定

- **CSS**：所有样式 `<style scoped>`，不使用预处理器。设计 Token 为 CSS 自定义属性，在 `global.css` 中定义。
- **TypeScript 类型**：前端在 `types/index.ts`，后端在 `backend/src/types/index.ts`，不要重复定义。
- **路径别名**：前端 `@` → `frontend/src/`。
- **中文排版**：「」引号，中文正文 `letter-spacing: 0.02em`。
- **禁止项**（见 DESIGN.md 反模式清单）：紫色渐变、渐变色球、Inter 做标题字体、Emoji 做图标、translateY hover 效果、胶囊按钮、彩色阴影。
- **LLM 交互**：见 [scripts/chat.md](scripts/chat.md)（中文回答、结构化输出、九锁协议）。
- **领域术语**：见 [CONTEXT.md](CONTEXT.md)。
- **实施计划**：见 [docs/项目修改计划-地质找矿方向.md](docs/项目修改计划-地质找矿方向.md)。
- **Vite 代理**：`/api` 代理到 `http://localhost:3000`。
- **敏感文件**：`.gitignore` 排除 `config.py`、`.env`、`*.db`、样本 PDF、地质图 TIFF、PPT 材料。

## 已知限制 & TODO

1. **GeoJSON 矢量图层**：`/spatial/layers` 和 `/spatial/layer/:name` 返回 503，等待 C 同学产出 GeoJSON 后接入
2. **坐标系**：模拟数据为 WGS84，AMap 需要 GCJ-02，偏移数百米但相对形状正确
3. **MapView 中心**：部分代码仍指向北京 `[116.397,39.908]`，应改为研究区坐标（Weiyai/Xiangshan ~93.5E, 41.5N）
4. **GraphView**：labelPlacement 类型兼容性、selectedNode null 访问风险
5. **BERT-NER**：主流程使用 dict regex 而非 BERT；BERT 模型用于学术研究用途

## 关键文件

| 文件 | 用途 |
|------|------|
| `frontend/src/views/QaView.vue` | 问答页：对话列表 + SSE 流式 + 内嵌高德地图 + MapPlan |
| `frontend/src/api/qa.ts` | 问答 API：JSON 模式 + SSE 流式（Fetch 手动解析，dev 直连 :3000） |
| `frontend/src/stores/qa.ts` | 问答 Store：对话 CRUD + sendMessageStream() + localStorage 持久化 |
| `frontend/src/components/ChatMessage.vue` | 聊天消息：Markdown + SourceCard + KG 标签 + 地图查看入口 |
| `frontend/src/types/index.ts` | 前端类型：Message/KGPath/SpatialData/ProspectivityScore/MapPlan/RuntimeSettings |
| `frontend/vite.config.ts` | Vite：插件、别名、自动导入、/api 代理到 :3000 |
| `frontend/DESIGN.md` | 视觉设计规范（权威参考） |
| `backend/src/routes/qa.ts` | 核心问答路由：三路并行检索 → LLM，SSE 流式(meta→chunk→done) |
| `backend/src/routes/spatial.ts` | 空间查询 + 成矿预测网格 |
| `backend/src/services/llm/gateway.ts` | LLM Gateway：多模型调度 + 异常互备 + mock降级 |
| `backend/src/services/kg.ts` | Neo4j 客户端：6 种节点 × 8 种关系 |
| `backend/src/services/prospectivity-grid.ts` | 成矿预测网格计算（基于 @turf/turf） |
| `backend/src/services/runtime-settings.ts` | 运行时检索配置读写 |
| `backend/src/db/sqlite.ts` | SQLite 数据层（读 Python DB + qa_logs） |
| `ml-service/server.py` | Flask 检索微服务 + 开发面板 dashboard |
| `ml-service/scripts/run_pipeline.py` | 全量预处理管线入口（支持 --from-step4） |
| `ml-service/scripts/dict_ner_geology.py` | 词典标注 NER（最终方案，300+ 词） |
| `start_all.py` | 一键启动器（Flask + 浏览器打开开发面板） |
| `CONTEXT.md` | 领域术语表 |
| `plans/5day-plan.md` | 终期汇报推进计划 |
| `scripts/chat.md` | LLM 交互准则（九锁协议） |
