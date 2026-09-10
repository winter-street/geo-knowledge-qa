# 后端代码速查表

> 20 个 TypeScript 文件，按层整理。每一行对应一个关键代码段，标注行号和一句话说明。

---

## 入口层

### 1. `backend/src/index.ts` — Express 启动入口

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 1-8 | `import` 语句 | 导入所有路由和中间件 | 挂载 `qaRouter/kgRouter/adminRouter/authRouter/uploadRouter/spatialRouter` |
| 14-16 | `cors()` + `express.json()` | 中间件配置 | CORS 开放 `:5173` `:5000`，JSON body 限制 1MB |
| 19 | `app.use(authMiddleware)` | 全局鉴权 | 除 `/api/auth/login` 和 `/api/health` 外全部需 JWT |
| 21-26 | `app.use('/api', ...)` | 路由挂载 | 6 个路由模块统一挂载到 `/api` 前缀下 |
| 28-30 | `GET /api/health` | 健康检查 | 返回 `{ status: 'ok', timestamp }` |
| 32-44 | `GET /api/health/detailed` | 详细健康检查 | 实时检测 Neo4j + Flask 连接状态 |
| 46-56 | `bootstrap()` | 启动流程 | 依次执行：Neo4j 初始化 → Flask 确认 → 监听端口 |

---

## 配置层

### 2. `backend/src/config.ts` — 环境变量加载

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 1-4 | `dotenv.config()` | 加载 .env 文件 | 把 `.env` 里的配置读入 `process.env` |
| 6-13 | `requireEnv()` | 必填环境变量检查 | key 缺失时打 warn 返回空字符串，不阻塞启动 |
| 16-17 | `port` | 服务端口 | 默认 3000，可通过 `PORT` 环境变量覆盖 |
| 18-22 | `neo4j` | Neo4j 连接配置 | uri/user/password，默认 `bolt://localhost:7687` |
| 24-28 | `deepseek` | DeepSeek API 配置 | apiKey/model/baseURL，model 默认 `deepseek-chat` |
| 30-34 | `tongyi` | 通义千问 API 配置（备用） | 不填 key 则不在 Gateway 注册 |
| 36-38 | `retrieval` | 检索配置 | `topK` 默认 5，可通过 `RETRIEVAL_TOP_K` 调整 |
| 40 | `jwtSecret` | JWT 签名密钥 | 生产环境必须修改 |

---

## 鉴权层

### 3. `backend/src/middleware/auth.ts` — JWT 鉴权

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 6-10 | `JwtPayload` 接口 | 定义 JWT 载荷结构 | userId + username + role(`user`/`admin`) |
| 12-17 | `signToken()` | 签发 JWT | 24h 有效期，用 `jwtSecret` 签名 |
| 19-22 | `verifyToken()` | 验证 JWT | 失败抛异常，由调用方 catch |
| 24-54 | `authMiddleware()` | 全局鉴权中间件 | OPTIONS 放行 / 公开路由跳过 / 其余校验 Bearer Token |
| 32-33 | `publicPaths` | 公开路由白名单 | `/api/auth/login` `/api/health` 免鉴权 |
| 39-43 | Token 提取 | 从 Header 取 Bearer Token | `Authorization: Bearer xxx` → 截取 `xxx` |
| 56-64 | `adminMiddleware()` | 管理员权限中间件 | role 不是 `admin` 返回 403 |

---

## 路由层

### 4. `backend/src/routes/qa.ts` — 核心问答接口

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 21-29 | `POST /api/qa/ask` | 问答入口 | 接收 `{ question, stream? }` |
| 33-37 | `Promise.all` | **三路并行检索** | RAG(`tfidf.search`)+KG(`searchEntities`)+空间(`getSpatialResults`) |
| 40-44 | `matchMockSpatial()` | 空间 mock 降级 | Neo4j 无坐标时自动用硬编码数据 |
| 45-47 | `spatialCount` | 空间数据计数 | markers + polylines 总数 |
| 49-52 | 闲聊拦截 | 低分无 KG 时返回引导语 | `topScore < 0.04` 且 KG 为空 → greeting |
| 68-115 | **SSE 流式模式** | `stream:true` 时走此分支 | `text/event-stream` 逐 token 推送 |
| 79-85 | SSE `meta` 事件 | 检索元信息 | 告知前端 RAG/KG/空间各命中多少条 |
| 92-105 | SSE `done` 事件 | 流式结束 | 返回 sources + kgContext + spatialData |
| 106-115 | 问答日志写入 | `insertQaLog()` | 记录问题/路径/命中数/KG数/空间数/耗时 |
| 117-148 | **普通 JSON 模式** | `stream:false` 时走此分支 | 完整响应一次性返回 |
| 137-143 | `QaAskResponse` | 响应结构 | `{ answer, sources, kgContext, spatialData }` |

### 5. `backend/src/routes/kg.ts` — 知识图谱路由

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 11-27 | `GET /api/kg/subgraph` | 图谱子图 | 前端 GraphView 调用，返回 nodes + edges |
| 15-16 | `req.query.depth` | 跳数参数 | 可选 1/2/3，默认 2 |
| 34-55 | `GET /api/kg/spatial` | 空间数据查询 | 前端 MapView 独立调用，mock 降级 |
| 44-47 | `matchMockSpatial()` | 空间 mock 降级 | Neo4j 无坐标时自动查 mock 数据 |

### 6. `backend/src/routes/admin.ts` — 后台管理路由

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 16-30 | `GET /api/admin/stats` | 统计概览 | 文档数(SQLite)+chunks(SQLite)+实体数(Neo4j)+问答数(SQLite) |
| 34-46 | `GET /api/admin/docs` | 文档列表 | 从 SQLite `documents` 表查，status 按 chunkCount 动态判断 |
| 51-61 | `GET /api/admin/docs/:id` | 文档详情+chunks | 前端"查看"弹窗用 |
| 66-75 | `GET /api/admin/entities` | 实体列表 | 从 Neo4j 查，按类型+关系数排列 |
| 80-103 | `GET /api/admin/retrieval-config` | 检索配置 | 动态检测 BGE/NER/OWL 实际可用状态 |
| 105-112 | `GET /api/admin/entities/:id` | 实体详情 | 前端"查看实体"弹窗用 |
| 114-133 | `PUT /api/admin/entities/:id` | 更新实体属性 | 可修改 name/description/status |
| 138-148 | `DELETE /api/admin/docs/:id` | 删除文档 | 删 SQLite documents + chunks |
| 150-160 | `DELETE /api/admin/entities/:id` | 删除实体 | Neo4j `DETACH DELETE` |

### 7. `backend/src/routes/auth.ts` — 登录路由

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 主体 | `POST /api/auth/login` | JWT 登录 | 验证账号密码 → 返回 `{ token, username, role }` |

### 8. `backend/src/routes/upload.ts` — PDF 上传

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 14-18 | `multer.diskStorage` | 文件存储配置 | 存到 `backend/uploads/`，文件名加时间戳防重 |
| 39-49 | `multer({...})` | 上传限制 | 仅 PDF，最大 50MB |
| 56-77 | `POST /api/admin/docs/upload` | 接收文件 + 触发管线 | 保存后 `spawn('python', ['run_pipeline.py', '--file', path])` |
| 85-96 | 错误处理 | multer 异常拦截 | 文件过大/格式错误友好提示 |

### 9. `backend/src/routes/spatial.ts` — 空间数据路由

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 37-39 | `GET /api/spatial/layers` | 图层列表 | 返回可用 GeoJSON 图层（当前空，等 C 产出） |
| 44-55 | `GET /api/spatial/layer/:name` | 图层 GeoJSON | 返回指定图层数据（当前返回 503） |
| 59-78 | `POST /api/spatial/query` | 空间+语义联合查询 | 按 keyword + bbox + entityTypes 查询（骨架就绪） |

---

## 服务层 — LLM

### 10. `backend/src/services/llm/provider.ts` — LLM Provider 接口

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 4-31 | `LLMProvider` 接口 | 统一 Provider 契约 | 定义 `name` + `generateAnswer()` + `generateAnswerStream()` |

### 11. `backend/src/services/llm/deepseek.ts` — DeepSeek Provider

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 16-24 | `DeepSeekProvider` 类 | 主模型 Provider | 用 OpenAI 兼容 SDK 调用 DeepSeek API |
| 26-54 | `generateAnswer()` | 非流式生成 | POST `/chat/completions`，30s 超时 |
| 56-98 | `generateAnswerStream()` | SSE 流式生成 | `stream:true`，逐 token yield → `onChunk()` 回调 |

### 12. `backend/src/services/llm/tongyi.ts` — 通义千问 Provider

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 21-34 | `TongyiProvider` 类 | 备用模型 Provider | 结构同 DeepSeek，baseURL 改为 DashScope |
| 30-33 | 延迟初始化 | 仅配了 key 才创建客户端 | 未配置时调用会抛异常提示 |
| 36-41 | `ensureClient()` | 懒加载检查 | 运行时抛 `"通义千问 API key 未配置"` |

### 13. `backend/src/services/llm/gateway.ts` — LLM 多模型调度

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 16-21 | `register()` | 注册 Provider | 先注册的优先调用 |
| 27-59 | `generateAnswer()` | 非流式（带互备） | 主模型失败→自动切备用→全失败则 mock 降级 |
| 62-93 | `generateAnswerStream()` | 流式（无互备） | 仅用主模型，失败降级为非流式 mock |
| 96-108 | `isRetryable()` | 可重试判断 | timeout/refused/429 等错误才切换，其他错误直接降级 |
| 110-140 | `mockAnswer()` | Mock 降级回答 | 直接返回检索结果原文，提示"LLM 服务暂时不可用" |

### 14. `backend/src/services/llm.ts` — Prompt 构建 + Gateway 入口

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 12-27 | Provider 注册 | 按配置激活 LLM | DeepSeek 必注册（有 key 时），通义千问答可选 |
| 35-36 | `SYSTEM_PROMPT` | 系统提示词 | 定义 AI 角色 + 5 条回答规则 |
| 38-81 | `buildPrompt()` | **上下文拼接** | 把 RAG chunks + KG 关系 拼成完整 Prompt |
| 43-53 | └ RAG 部分 | 文档片段格式化 | `[文档片段 N]（来源：《xxx》第N页，相关度: X%）\n内容` |
| 55-62 | └ KG 部分 | 知识图谱格式化 | `「实体A」—[关系]→「实体B」` |
| 64-81 | └ 最终 Prompt | 三段式结构 | 系统提示 → RAG+KG 上下文 → 用户问题 → 回答要求 |
| 86-108 | `generateAnswer()` / `generateAnswerStream()` | 公开 API | 委托给 Gateway |

---

## 服务层 — 检索

### 15. `backend/src/services/tfidf.ts` — Flask RAG 检索客户端

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 11-41 | `search()` | 调 Flask `/search` | POST question+top_k → 返回 BGE/TF-IDF 相似 chunks |
| 27-35 | └ 格式转换 | Flask → TS 类型 | `c.doc_title → chunk.docTitle` |
| 37-40 | └ 异常处理 | 网络错误静默返回空 | Flask 宕机不影响问答（只是 RAG 为空） |
| 43-53 | `toSources()` | chunks → 引用对象 | 截取前 120 字符作为 snippet |

### 16. `backend/src/services/kg.ts` — Neo4j 知识图谱检索

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 10-18 | `GEO_ENTITY_TYPES` | 实体类型常量 | 6 种节点：Mineral/Rock/Structure/TimePeriod/DepositType/Region |
| 20-30 | `GEO_RELATION_TYPES` | 关系类型常量 | 8 种关系：HOSTED_IN/CONTROLLED_BY/ASSOCIATED_WITH/... |
| 32-48 | `REL_CN` 映射表 | 英文→中文 | 15 个映射，展示用 |
| 50-52 | `cnRel()` | 关系名翻译函数 | 查表，找不到返回原文 |
| 58-78 | `initNeo4j()` | 连接初始化 | 启动时调用，创建连接池(10个) |
| 81-84 | `getSession()` | 获取会话 | 每次查询前获取，用完关闭 |
| **93-190** | **`searchEntities()`** | **核心：KG 路径检索** | **QA 调用的主函数** |
| 103-106 | └ 分词提取关键词 | jieba → 过滤单字 | 最多取 5 个关键词 |
| 108-110 | └ `entityTypes` 过滤 | 可选限定节点类型 | 如只搜 Mineral 和 Structure |
| 124-150 | └ Cypher 查询 | `MATCH (n)-[r]->(m) WHERE n.name CONTAINS $kw` | 模糊匹配实体名 |
| 133-134 | └ 坐标返回 | `n.lng AS fromLng, n.lat AS fromLat` | C 加坐标后自动生效 |
| 145-146 | └ 推理标记 | `r.inferred AS inferred` | OWL 推理边标记 |
| 152-172 | └ 结果组装 | 提取 from/relation/to + 坐标 | 去重，最多 10 条 |
| 176-179 | └ 过滤文档引用 | 去掉 REFERENCES/引用类型 | 只保留地质语义边 |
| **199-255** | **`getSubgraph()`** | **前端图谱可视化** | **GraphView 专用** |
| 208-210 | └ 分词 | 同 searchEntities | |
| 217-237 | └ 多跳 Cypher | `(seed)-[r*1..N]-(m)` | 支持 1/2/3 跳展开 |
| 222-229 | └ Document 过滤 | Cypher 层排除文献节点 | 图谱只显示地质实体 |
| 250-255 | └ 边标签中文化 | `cnRel(relType)` | 前端图边显示"受控于" |
| **261-376** | **`getSpatialResults()`** | **空间坐标检索** | **地图标注专用** |
| 278-295 | └ 查含坐标节点 | `WHERE n.lng IS NOT NULL AND n.lat IS NOT NULL` | 矿产点/岩石点 |
| 309-340 | └ 查含路径节点 | `WHERE n.path IS NOT NULL` | 断裂线/构造线 |
| 380-399 | `getEntityDetail()` | 实体详情 | 后台管理→实体查看 |
| 401-416 | `updateEntity()` | 更新实体属性 | 后台管理→实体编辑保存 |
| 422-437 | `deleteEntity()` | 删除实体 | Neo4j `DETACH DELETE` |
| 439-443 | `closeNeo4j()` | 关闭连接 | 应用退出时调用 |
| 445-484 | `getEntityStats()` | 实体统计 | 后台管理→实体列表 |

### 17. `backend/src/services/tokenizer.ts` — 中文分词

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 10-38 | `loadJieba()` | 加载 nodejieba + 注入词典 | 自定义 29 个词条，不可用时回退字粒度 |
| 41-49 | `STOP_WORDS` | 停用词表 | 过滤 60+ 高频无意义词（的/了/是/在/...） |
| 52-76 | `tokenize()` | 分词主函数 | jieba 分词 → 过滤停用词+标点+纯数字 |
| 78-81 | `tokenizeBatch()` | 批量分词 | 数组版本 |

---

## 数据层

### 18. `backend/src/db/sqlite.ts` — SQLite 数据访问

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 6 | `DB_PATH` | 数据库路径 | 读 Python 管线产出的 `ml-service/output/geo_knowledge.db` |
| 12-19 | `getDb()` | 懒加载单例 | 首次调用时打开 + 初始化 qa_logs 表 |
| 21-35 | `initQaLogs()` | qa_logs 表建表+迁移 | CREATE TABLE + ALTER 补新列(kg_count/spatial_count) |
| 37-41 | `tableExists()` | 安全检查 | 表不存在时优雅返回空，防 500 |
| 45-68 | `getDocs()` | 文档列表 | `documents LEFT JOIN chunks` 统计切片数 |
| 72-86 | `getDocById()` | 文档详情 | 单个文档 |
| 90-101 | `getChunksByDocId()` | 文档切片 | 某文档全部 chunk |
| 107-118 | `insertQaLog()` | 写问答日志 | 记录问题/路径/RAG数/KG数/空间数/耗时 |
| 120-133 | `getQaLogs()` | 问答日志列表 | 最近 100 条 |
| 135-142 | `getStats()` | 统计 | docCount/chunkCount/logCount |
| 144-154 | `deleteDoc()` | 删文档+切片 | `DELETE FROM chunks` + `DELETE FROM documents` |

---

## 类型层

### 19. `backend/src/types/index.ts` — 共享类型定义

| 行号 | 类型 | 用途 |
|------|------|------|
| 1-8 | `Chunk` | 文本块 |
| 10-16 | `Source` | 检索引用来源 |
| 18-29 | `KGPath` | 知识图谱关系路径（含坐标） |
| 31-49 | `GraphNode` / `GraphEdge` / `Subgraph` | 前端 GraphView 数据 |
| 56 | `GeoEntityType` | 地质实体类型联合类型 |
| 58-99 | `MineralEntity` / `RockEntity` / `StructureEntity` | 地质实体接口 |
| 105-127 | `GeoPoint` / `GeoPolyline` / `SpatialData` | 地图标注数据 |
| 129-139 | `SpatialFeature` / `SpatialLayer` | 空间图层 |
| 143-160 | `SpatialQueryRequest` / `SpatialQueryResponse` | 空间查询接口 |
| 166-178 | `QaAskRequest` / `QaAskResponse` | 问答接口契约 |
| 184-193 | `DocumentRecord` | 文档记录 |
| 195-217 | `AppConfig` | 环境配置结构 |

---

## Mock 数据层

### 20. `backend/src/data/spatial-mock.ts` — 空间 Mock 数据

| 行号 | 代码 | 作用 | 一句话 |
|------|------|------|--------|
| 11 | `MOCK_SPATIAL` | 硬编码空间数据字典 | Key=关键词，Value=markers+polylines |
| 18-65 | `'断裂带'` / `'断裂'` | 问题1 mock | 3 矿点 + 2 断裂线 |
| 78-117 | `'铁矿'` / `'钒钛磁铁矿'` | 问题2 mock | 4 个铁矿产点 |
| 128-143 | `'燕山期'` / `'岩石'` | 问题3 mock | 3-4 岩石分布点 |
| 148-164 | `'新疆'` | 区域关键词 | 尾亚+香山+恰瓦克南矿点 |
| 166-178 | `'哈密'` | 区域关键词 | 3 矿点 + 2 断裂线 |
| 183-190 | `matchMockSpatial()` | 模糊匹配函数 | keyword 包含或包含于某个 key 即命中 |
