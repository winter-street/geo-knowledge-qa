# 预处理代码功能索引

> 总计 34 个 `.py` 文件（配置 2 + 服务 1 + 管线脚本 18 + 测试 12 + 环境检查 1）
> 生成日期：2026-07-10

---

## 一、配置文件（2 个）

| 文件 | 行数 | 功能 | 关键内容 |
|------|:---:|------|---------|
| `config.py` | 72 | 全局配置（含敏感信息，gitignore） | PDF_FILES（12篇地质PDF）、SQLite/TF-IDF路径、chunk参数(512/128)、jieba、DeepSeek API(deepseek-chat, temp=1.0, max_tokens=8192)、Neo4j连接、RETRIEVAL_MODE="bge" |
| `config.example.py` | 57 | 配置模板（安全，可提交git） | 同上结构，API Key和密码默认为空字符串 |

---

## 二、主管线：数据加工流水线（6 步）

运行入口：`python scripts/run_pipeline.py`（支持 `--from-step4` 跳过前3步，`--file` 单文件增量上传）

### Step 1 — PDF 解析

| 文件 | 行数 | 输入 | 输出 | 核心逻辑 |
|------|:---:|------|------|---------|
| `scripts/parse_pdf.py` | 71 | PDF 文件路径 | `{"title", "total_pages", "pages": [{page_num, text}]}` | pdfplumber 逐页提取文本，`_clean_text()` 合并断行、去除多余空白 |

### Step 2 — 文本切片

| 文件 | 行数 | 输入 | 输出 | 核心逻辑 |
|------|:---:|------|------|---------|
| `scripts/chunk_text.py` | 140 | parse_pdf 输出 | `[{doc_id, page, chunk_index, text, char_start, char_end}]` | 512字符窗口 + 128字符重叠，`_find_break_point()` 优先在段落边界/句号/换行/逗号处断句 |

### Step 3 — TF-IDF 向量化 + SQLite 存储

| 文件 | 行数 | 输入 | 输出 | 核心逻辑 |
|------|:---:|------|------|---------|
| `scripts/build_index.py` | 190 | (parsed_doc, chunks) 对列表 | SQLite DB + TF-IDF pickle模型 | 创建 `documents`/`chunks` 表（含 `vector` BLOB），jieba分词，TfidfVectorizer 训练，joblib保存模型。支持增量模式 |

### Step 3b — BGE 语义向量（替换 TF-IDF）

| 文件 | 行数 | 输入 | 输出 | 核心逻辑 |
|------|:---:|------|------|---------|
| `scripts/embed_chunks.py` | 89 | SQLite DB路径 | SQLite `chunks.vector` 列写入 float32 BLOB | bge-small-zh-v1.5 (dim=512)，SentenceTransformer encode + normalize，维护 `meta` 表记录 vector_type/vector_dim |

### Step 4 — 实体抽取

| 文件 | 行数 | 输入 | 输出 | 核心逻辑 |
|------|:---:|------|------|---------|
| `scripts/extract_hybrid.py` | 419 | PDF解析文本 + LLM配置 | `{"concepts": [...], "relations": [...]}` | **当前主力抽取器**：词典正则（312+地质术语）→ 主体发现；BERT-NER 补充弱覆盖页面的未知实体；LLM 4并发抽关系；`RELATION_WHITELIST` 类型校验。支持 dry_run |
| `scripts/extract_concepts.py` | 382 | PDF解析文本 + LLM配置 | `{"concepts": [...], "relations": [...]}` | LLM 直出 JSON 实体+关系（6并发），含 JSON 修复（代码块提取、花括号匹配、截断修复）、多段结果合并去重 |
| `scripts/extract_landuse.py` | 122 | parse_pdf 输出 | `[{name, code, level, parent_code}]` | 正则提取国土用地分类层级（2位大类/4位中类/6位小类），构建父子关系 |
| `scripts/extract_glossary.py` | 141 | 术语标准PDF解析文本 | `[{name, definition, type, source}]` | 状态机解析"术语名+定义段"格式，处理 `[注]` 和 `[来源：...]` |
| `scripts/extract_survey_terms.py` | 288 | GB/T 14911-2008测绘术语PDF | `[{name, definition, type}]` | 处理 PDF 英文→罕见CJK字形渲染问题，全角编号解析，同义词行检测 |

### Step 5 — Neo4j 写入

| 文件 | 行数 | 输入 | 输出 | 核心逻辑 |
|------|:---:|------|------|---------|
| `scripts/write_neo4j.py` | 286 | parsed_docs + 实体 + 关系 | Neo4j 知识图谱 | 创建6类节点（Mineral/Rock/Structure/TimePeriod/DepositType/Document），写坐标(lng/lat)，建8类关系，Document→Entity REFERENCES 链接。支持增量模式 |

### Step 6 — OWL 本体 + 推理

| 文件 | 行数 | 输入 | 输出 | 核心逻辑 |
|------|:---:|------|------|---------|
| `scripts/build_ontology.py` | 286 | Neo4j 图谱数据 | `output/geo_planning.owl` + 报告 | owlready2 动态建类（GeoEntity父类+6子类），7种对象属性，传递性公理（BELONGS_TO/CONTROLLED_BY），168条硬编码地质年代层级链 |
| `scripts/run_reasoning.py` | 175 | OWL文件 | Neo4j 推理关系（`inferred: true`） | BFS 传递闭包 + HermiT 推理器，差分计算（post - pre），结果写回 Neo4j |

---

## 三、Flask 检索微服务

| 文件 | 行数 | 功能 | 端点列表 |
|------|:---:|------|---------|
| `server.py` | 624 | HTTP 检索微服务（:5000） | `POST /search`（BGE/TF-IDF向量检索）、`POST /kg/search`（Neo4j子图）、`POST /ner`（BERT-NER）、`GET /health`、`GET /stats`、`GET /dashboard`、`POST /start|stop/<service>`（进程管理）、`POST /ontology/reason|status|query` |

### server.py 关键函数

| 函数 | 功能 |
|------|------|
| `load_ner_model()` | 懒加载 `models/bert-ner/` 下的 BERT-NER 模型 |
| `load_bge_index()` | 从 SQLite 加载 BGE 向量矩阵（numpy），用于快速余弦相似度搜索 |
| `get_model()` | 懒加载 TF-IDF pickle 模型 |
| `get_neo4j()` | 懒连接 Neo4j driver |
| `_tokenize()` | jieba 分词 |
| `_cosine_similarity()` | numpy 余弦相似度计算 |

---

## 四、NER 训练流程（9 个脚本）

### 标注数据生成（4 种路线均可独立运行）

| 文件 | 行数 | 路线 | 核心逻辑 |
|------|:---:|------|---------|
| `scripts/dict_ner_geology.py` | 332 | ③ 词典正则（**最终方案，F1=0.99**） | Neo4j实体 + 312个硬编码词 → 按类型分组编译正则（最长优先）→ 扫描PDF全文 → 8个模板生成合成句 → 合并LLM稀有类型补充 → 输出 `ner_final.conll` |
| `scripts/batch_ner_geology.py` | 255 | ② LLM JSON→BIO（备份） | 8并发DeepSeek抽实体JSON → 精确字符串匹配转BIO标签 → PDF文本缓存(`parsed_texts.json`)加速重跑 |
| `scripts/batch_ner_annotate.py` | 95 | ① LLM BIO 直出（v1） | 单PDF前40段（250字/段），顺序标注+1秒间隔 |
| `scripts/batch_ner_smart.py` | 99 | ① 变体（种子词过滤） | jieba预筛选含Neo4j种子词的段落 → 仅标注命中段，减少API调用 |
| `scripts/ner_annotate.py` | 195 | LLM 辅助标注工具函数 | `build_ner_prompt()` / `parse_bio_response()` / `annotate_text()` / `bio_to_conll()`，共5种实体类型 |
| `scripts/glossary_to_bio.py` | 103 | 术语词典辅助 | 术语名+定义 → 合成句"{term}: {definition}" → BIO标签 |
| `scripts/merge_all_ner.py` | 54 | 多源合并 | 读取多个 .conll → 按实体去重 → 输出 `ner_final.conll` |

### 训练与评估

| 文件 | 行数 | 功能 | 核心逻辑 |
|------|:---:|------|---------|
| `scripts/prepare_ner_data.py` | 110 | 数据清洗+数据集划分 | 清洗无效标签→80:10:10分割(seed=42)→test集锁定防污染 |
| `scripts/train_ner.py` | 132 | BERT-NER 微调 | bert-base-chinese，11标签（O/B-I-Mineral/Rock/Structure/TimePeriod/DepositType），18 epochs，AdamW(lr=2e-5, bs=16)，保存到 `models/bert-ner/` |
| `scripts/eval_ner.py` | 105 | NER 评估 | seqeval 评估，主力类(Mineral+Rock)加权F1，≥0.70通过，<0.50回退LLM |

---

## 五、环境检查

| 文件 | 行数 | 功能 |
|------|:---:|------|
| `verify_env.py` | 83 | 验证 torch/transformers/seqeval/sentence-transformers/bert-base-chinese/bge-small-zh-v1.5 均可导入且正常工作 |

---

## 六、测试文件（12 个）

| 文件 | 行数 | 测试目标 | 测试内容 |
|------|:---:|------|---------|
| `test_parse_pdf.py` | 48 | parse_pdf | 返回结构正确（title/total_pages/pages），total_pages=pages长度 |
| `test_chunk.py` | 73 | chunk_text | keys正确、chunk大小在50-800范围、chunk_index顺序、char_start单调递增、重叠验证 |
| `test_build_index.py` | 87 | build_index | 全流程（临时目录）：SQLite建表、documents/chunks表记录数正确、vector非空、TF-IDF模型可加载且能transform |
| `test_extract_landuse.py` | 64 | extract_landuse | 返回50+节点、keys正确、level合法（大类/中类/小类）、code长度匹配level |
| `test_extract_concepts.py` | 109 | extract_concepts | split_into_sections、build_extraction_prompt包含必要元素、parse_llm_response处理普通JSON和代码块JSON、merge_results去重 |
| `test_extract_glossary.py` | 44 | extract_glossary | 返回50+术语、含name/definition/type、definition≥10字符、含已知术语 |
| `test_ner_annotate.py` | 90 | ner_annotate | prompt含输入文本和标签说明、BIO解析正确、CONLL格式有效 |
| `test_write_neo4j.py` | 133 | write_neo4j | Neo4j连接(`RETURN 1`)、单节点创建验证、关系创建验证、批量3节点写（2条边）。需运行中Neo4j |
| `test_glossary_to_bio.py` | 61 | glossary_to_bio | 生成有效BIO格式含B-SPATIAL，30个真实术语≥20个B-标签 |
| `test_bridge_landuse_concept.py` | 66 | bridge_landuse_concept | 匹配测试："湿地"匹配"湿地保护"，"工业用地"匹配"工业用地布局"，"耕地"不错误匹配"容积率" |

---

## 七、数据流总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                       主管线 (run_pipeline.py)                        │
│                                                                      │
│  PDF → parse_pdf → chunk_text → build_index → embed_chunks          │
│                                       │                              │
│                                       ▼                              │
│                              extract_hybrid (词典+NER+LLM)            │
│                                       │                              │
│                                       ▼                              │
│                              write_neo4j (→ Neo4j 知识图谱)          │
│                                       │                              │
│                                       ▼                              │
│                       build_ontology → run_reasoning (→ OWL推理)     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     NER 训练侧管线                                    │
│                                                                      │
│  dict_ner_geology + batch_ner_geology + batch_ner_annotate           │
│         │                                                            │
│         ▼                                                            │
│  merge_all_ner → prepare_ner_data → train_ner → eval_ner            │
│                                                  │                   │
│                                BERT-NER 模型 ──→ extract_hybrid 中使用 │
│                                BERT-NER 模型 ──→ server.py /ner 端点  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     运行时服务                                        │
│                                                                      │
│  server.py (:5000) ←── 后端 backend (:3000)                          │
│       │                    │                                         │
│       ├─ SQLite (BGE向量)  │                                         │
│       ├─ TF-IDF pickle     │                                         │
│       ├─ Neo4j (KG)        │                                         │
│       └─ BERT-NER 模型     │                                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 八、按功能分类速查

### 你想做什么 → 找哪个文件

| 需求 | 文件 |
|------|------|
| 跑全量数据管线 | `scripts/run_pipeline.py` |
| 解析新 PDF | `scripts/parse_pdf.py` |
| 调整切片参数（大小/重叠） | `scripts/chunk_text.py` |
| 重建向量索引 | `scripts/build_index.py`（TF-IDF）或 `scripts/embed_chunks.py`（BGE） |
| 从地质报告抽实体+关系 | `scripts/extract_hybrid.py`（主力）或 `scripts/extract_concepts.py`（纯LLM） |
| 从规划标准抽用地分类 | `scripts/extract_landuse.py` |
| 从标准文件抽术语定义 | `scripts/extract_glossary.py` / `scripts/extract_survey_terms.py` |
| 把数据写入 Neo4j | `scripts/write_neo4j.py` |
| 生成 OWL 本体 | `scripts/build_ontology.py` |
| 运行 OWL 推理 | `scripts/run_reasoning.py` |
| 生成 NER 训练数据 | `scripts/dict_ner_geology.py`（词典，F1=0.99）或 `scripts/batch_ner_geology.py`（LLM） |
| 训练 BERT-NER | `scripts/train_ner.py` |
| 评估 NER 效果 | `scripts/eval_ner.py` |
| 启动 Flask 检索服务 | `server.py` |
| 检查 Python 环境 | `verify_env.py` |
| 改配置 | `config.py`（复制 `config.example.py` 填入真实值） |
