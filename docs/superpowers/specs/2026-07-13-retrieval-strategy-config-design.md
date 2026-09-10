# 检索策略配置改造设计

日期：2026-07-13

## 目标

将管理员后台现有的「检索配置」标签从只读展示和进程内临时参数，改为真实、持久且可验证的问答策略控制面。页面不新增路由或标签。

管理员可以：

- 查看 BGE、TF-IDF、知识图谱和空间检索的真实可用状态；
- 启用或停用 RAG、知识图谱、空间三条运行时路径；
- 在 BGE 与 TF-IDF 中选择 RAG 模式；
- 配置 RAG、知识图谱和空间证据权重，以及 Top-K；
- 配置 DeepSeek 模型、最大 Token 与 Temperature；
- 保存并在后续问答中使用上述设置，重启后仍保持。

BERT-NER 与 OWL 不是当前 HTTP 问答链路的独立检索器。它们将作为「离线增强能力」展示其模型/产物状态及重建提示，不提供会造成误解的运行时开关。

## 非目标

- 不在本次改造中实现在线 BERT-NER 重新训练、OWL 重推理或切片重建；
- 不实现真实 reranker。页面仅在后端存在该能力后才显示并允许配置其阈值；
- 不把管理参数同步写入 `.env`。环境变量只提供首次启动的默认值；
- 不改变普通用户的问答页面交互或已有 `retrievalMode` 请求字段的兼容行为。

## 页面设计

保留「知识库管理 > 检索配置」标签，按下列顺序呈现：

1. **服务与索引状态**：BGE 索引、TF-IDF 索引、Neo4j、空间数据源、BERT-NER 产物、OWL 本体产物。状态来自健康检查与文件/服务探测，失败时显示原因和刷新入口，不能以硬编码 `true` 代替。
2. **检索策略**：
   - RAG 启用开关；RAG 模式单选为 BGE 或 TF-IDF；Top-K 输入；
   - KG 启用开关及权重输入；
   - 空间检索启用开关及权重输入；
   - RAG 权重输入。三个权重以 0 到 1 的数值保存；页面显示合计并提示它们用于证据排序，而非强制要求合计为 1。
3. **生成参数**：DeepSeek 模型、最大 Token、Temperature。
4. **离线增强能力**：BERT-NER 与 OWL 的产物可用状态、最后更新时间和「需离线重建」说明。切片大小、切片重叠只在此处只读展示。

保存按钮只提交可生效字段。若策略尚未保存或服务不可用，禁用相应控件并给出具体原因。页面应显示配置的保存时间和是否已在当前问答进程加载。

## 持久化与接口

在 `ml-service/output/geo_knowledge.db` 中新增单行 `runtime_settings` 表，由 Node 的 SQLite 数据层执行初始化和读写。使用 JSON 或明确字段均可；推荐明确字段，便于约束和后续查询：

- `rag_enabled`、`rag_mode`（`bge | tfidf`）、`rag_weight`、`rag_top_k`；
- `kg_enabled`、`kg_weight`；
- `spatial_enabled`、`spatial_weight`；
- `llm_model`、`max_tokens`、`temperature`；
- `updated_at`、`updated_by`。

启动时按「SQLite 已保存值 -> 环境变量默认值 -> 代码默认值」加载。`PUT /api/admin/retrieval-config` 对全部字段进行服务端校验并在同一事务写入；写入成功后更新内存缓存，返回完整配置及状态快照。失败时不更新缓存。

`GET /api/admin/retrieval-config` 返回：`settings`、各能力的 `available/reason`、离线产物元数据和最近更新时间。前端不再依赖 `public/mock/retrieval-config.json` 来掩盖真实后端错误；仅开发 mock 模式可显式使用 mock。

## 问答执行链路

1. 问答路由读取已加载的持久化设置，并将原请求 `retrievalMode` 与管理员总开关相交。显式请求 `rag`、`kg`、`hybrid` 仍可缩小范围，不能绕过管理员关闭的路径。
2. 若 RAG 开启，Node 向 Flask `/search` 发送 `retrieval_mode: bge | tfidf` 与 `top_k`。Flask 验证请求模式；BGE 索引不可用时返回明确的 503/能力错误，不静默改用 TF-IDF。Node 将这类失败记录为路径不可用。
3. 若 KG 开启，执行现有 `searchEntities`；若空间开启，执行 `resolveSpatialForQuestion`。关闭路径不调用对应服务，也不把 mock 空间数据混入结果。
4. RAG 片段以其原始相似度乘 `rag_weight` 排序；KG 与空间不混入文本片段分数，而在给 LLM 的上下文和问答日志中记录各自启用状态、命中数和权重。权重为 0 的已开启路径仍执行，但不作为高优先级证据；界面应提示这一语义。
5. `pathUsed` 记录实际成功使用的路径和 RAG 模式，例如 `bge`、`kg`、`spatial`，而不是配置期望值。低相关性判断只基于实际启用且成功执行的路径。

## 真实状态检测

- Flask 新增或扩展健康接口，返回 BGE 索引、TF-IDF 模型、当前可选模式与载入错误；
- Neo4j 状态通过轻量连接验证或已有详细健康检查返回，不以驱动初始化成功代替查询成功；
- 空间状态区分 `neo4j`、`geojson`、`mock` 与 `none`，前端明确展示 mock 仅为演示数据；
- BERT-NER 和 OWL 只检查实际模型/本体文件和可选元数据，不声称它们参与每一次问答。

## 错误处理

- 保存字段非法时，返回 400 和字段级错误；前端保留未保存输入，不以刷新覆盖；
- 某条检索路径不可用时，问答继续使用其他开启路径，并把不可用原因记录到服务日志；
- 若所有查询路径均关闭或不可用，返回可识别的「未配置可用检索路径」响应，不调用 LLM 伪造基于知识库的回答；
- 配置保存成功但运行时服务状态随后变差时，页面展示配置值与当前不可用状态，不回滚管理员设置。

## 测试与验收

- 后端单测：默认加载、SQLite 持久化、字段校验、重启后恢复；
- 问答路由测试：关闭的路径不被调用；BGE/TF-IDF 请求模式正确转发；实际 `pathUsed`、权重排序和低相关性判断正确；
- Flask 测试：显式 `retrieval_mode` 正确选择索引，索引缺失返回明确错误；
- 前端测试：保存请求仅提交可编辑字段，服务不可用时控件/说明正确，保存失败不会丢失输入；
- 人工验收：修改并保存策略后问答日志反映真实路径；重启 Node 服务后配置保持；关闭空间路径后回答不再包含空间 mock 数据。

## 实施边界

主要修改范围为：`backend/src/db/sqlite.ts`、`backend/src/services/runtime-settings.ts`、`backend/src/routes/admin.ts`、`backend/src/routes/qa.ts`、`backend/src/services/tfidf.ts`、`ml-service/server.py`、`frontend/src/views/AdminView.vue` 及其相应类型和测试。既有空间功能正在开发中，本改造不得覆盖或回退该工作区的未提交改动。
