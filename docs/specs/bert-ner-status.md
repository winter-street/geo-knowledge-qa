# BERT-NER 进度快照

> 最后更新: 2026-07-09 | 状态: **C1+C4 已完成**，链路已验证通，待地质语料迁移

## 最终结果

| 任务 | 状态 | 结果 |
|------|------|------|
| C1 数据准备 | ✅ | 560 实体, 8:1:1 划分, 噪声清洗(12个) |
| C1 微调 | ✅ | bert-base-chinese 3 epoch, loss 0.51→0.06 |
| C1 评估 | ✅ | 主力类(SPATIAL+SURVEY) F1=0.9897 |
| C1 Flask /ner | ✅ | 短实体识别正确("城镇开发边界"→SPATIAL) |
| C4 向量编码 | ✅ | 121 chunk, bge-small-zh-v1.5, dim=512 |
| C4 /search 改造 | ✅ | mode=bge, RETRIEVAL_MODE 降级开关 |
| 端到端验证 | ✅ | Flask 三端点全部 200 |

## 标签分布（ner_final.conll 实测 2026-07-08）

| 标签 | 实体数 | 说明 |
|------|--------|------|
| SPATIAL | 251 | 空间管控线/区 |
| SURVEY | 230 | 测绘领域术语 |
| POLICY | 38 | 政策要求/措施 |
| FUNCTION | 31 | 功能分区 |
| INDICATOR | 10 | 规划指标 |
| ~~B-O~~ | 3 | 已清洗→O |
| ~~DEGREE~~ | 1 | 已清洗→O |

## 环境

- Python 3.13.7 (`D:\py313`)
- torch 2.6.0+cu124 (RTX 4070 Super 12G)
- transformers 5.13.0, sentence-transformers 5.6.0, seqeval 1.2.2

## 新增文件

| 文件 | 用途 |
|------|------|
| `verify_env.py` | 环境验证：torch CUDA + 模型加载 |
| `scripts/prepare_ner_data.py` | NER 数据清洗 + 8:1:1 划分 |
| `scripts/train_ner.py` | bert-base-chinese 微调 |
| `scripts/eval_ner.py` | seqeval 评估 |
| `scripts/embed_chunks.py` | bge 编码 121 chunk 写回 SQLite |
| `models/bert-ner/` | 微调模型 (406MB, 不入 git) |

## 改动文件

| 文件 | 改动 |
|------|------|
| `server.py` | 新增 `/ner` + `/search` 改用 bge + `HF_ENDPOINT` 移到顶部 |
| `scripts/ner_annotate.py` | ENTITY_TYPES 对齐（删 DEGREE、加 SURVEY）|
| `requirements.txt` | 加 torch/transformers/seqeval/sentence-transformers |

## 迁移到地质语料

- **C4 检索链路**：换语料零成本——地质文档切片 → bge 重新编码 → 入库，脚本零改动。
- **C1 NER 链路**：脚本不变，但需 ①重定义地质标签 ②用 LLM 对地质语料重跑标注生成新 CONLL。
- 标签体系锁定 5 类：SPATIAL/SURVEY/POLICY/FUNCTION/INDICATOR（`ner_annotate.py` 已对齐）。

## OWL 本体推理

C-3 OWL 已在另一 session 完成：
- `scripts/build_ontology.py` — 构建本体（LandUse 分类树 + Concept 类型 + 关系属性 + 公理）
- `output/geo_planning.owl` — 20KB OWL 文件
- server.py 已有三个路由：`/ontology/status`、`/ontology/reason`、`/ontology/query`

## 当前终期进度

| 任务 | 状态 |
|------|------|
| C-1 BERT-NER | ✅ 完成 |
| C-3 OWL 推理 | ✅ 完成（另一 session）|
| C-4 BERT 语义检索 | ✅ 完成 |
| PostGIS 空间查询 | ⬜ 待定（无空间数据源）|
| PDF 上传实时预处理 | ⬜ 待定 |
