# C1 + C4 设计：BERT-NER 微调 + BERT 语义检索

> 日期: 2026-07-08 | 角色: C（Python 预处理）| 状态: **已完成** — C1+C4 全链路验证通过 (2026-07-09)

## 背景与范围

### 项目方向已转：国土空间规划 → 地质找矿

2026-07-08 中期答辩后，小组确定后端应用领域为**地质找矿**，系统从「通用文档问答」转向「空间网格化成矿预测」。答辩核心质疑指向同一命门：系统凭什么是「地理」的、大模型凭什么替代不了。真正价值压在后段**空间应用**（空间网格化 = 真 Geo-KG）；前段「数据处理流 + 检索流」跨领域通用，换数据源即可迁移。

### 本 spec 的定位：验证领域无关的处理生产线

基于「处理链路通用、换语料即迁移」的判断，本 spec **不是为国土规划做 NER/检索**，而是**验证并跑通一条领域无关的处理生产线**——先用手头 564 条国土规划语料把链路（环境→微调→评估→Flask 集成 / 编码→检索改造）全程验证通，待地质语料（地质志/地质报告）到位后，同一套脚本换语料重投即可迁移到找矿领域。

**迁移成本差异（须知）**：
- **C4 检索链路**：换语料几乎零成本——地质文档切片 → bge 重新编码 → 入库，脚本零改动。
- **C1 NER 链路**：脚本不变，但标签是硬编码的领域知识。迁移时需 ①重定义地质标签（岩石/地质年代/矿产/构造类型，替换现 SPATIAL/POLICY/FUNCTION）②用 LLM 对地质语料重跑标注生成新 CONLL。故 C1 更该提前验证链路。

**本 spec 覆盖 C-1 + C-4**（同为 BERT 相关、共用 torch 地基）。OWL / PostGIS / PDF上传及**空间网格化成矿预测**（真正的价值段）留待后续 session，各自独立成 spec。

### 硬件与环境（2026-07-08 实测）

| 项 | 状态 |
|----|------|
| GPU | RTX 4070 Super 12G，当前占用 1.5G，可用 ~11G |
| 驱动 / CUDA | 596.49 / CUDA 13.2（向下兼容，装 cu124 torch 可用）|
| Python | 3.13.7（`D:\py313`）—— 需 torch ≥ 2.5 |
| torch / transformers / sentence-transformers | ❌ 均未安装 |
| pip 镜像 / HF_ENDPOINT | 默认 PyPI / 未设 —— 国内需配镜像 |
| 磁盘 | D 盘 754G 可用 |

### 成功标准

- C1（分层达标，不刷单一整体 F1）：
  - **主力类（SPATIAL + SURVEY，占 85%）F1 ≥ 0.70 → 算成功**。这两类样本足够、是演示真正用到的实体。
  - 小类（INDICATOR/POLICY/FUNCTION）如实报告数字，不设门槛（INDICATOR 仅 10 个样本，测试集可能只 1 个，答对答错都不代表模型价值）。
  - **降级线：主力类 F1 < 0.5 → 微调失败，退回 LLM 方案**。
  - `/ner` 端点对已知句子（"城镇开发边界内应控制容积率"）输出正确实体。
- C4：`bge-small-zh-v1.5` 编码 121 chunk 入库，`/search` 接口契约不变，已知问题召回质量优于 TF-IDF
- 两者集成进现有 Flask 微服务（:5000），B 后端零改动
- **本 spec 目标是「跑通链路 + 主力实体识别准」，非刷榜——这是答辩项目而非发论文，且链路本身要能迁移到地质语料。**

---

## 第 1 段：环境地基（C1+C4 共用前提）

```
D:\py313 (Python 3.13.7)
   │  pip install，走清华镜像
   ▼
torch 2.5+ (cu124)      ← 吃满 RTX 4070S
transformers            ← 加载/微调 bert
seqeval                 ← NER 的 P/R/F1 评估
sentence-transformers   ← C4 加载 bge
   │  设 HF_ENDPOINT=https://hf-mirror.com
   ▼
预下模型到本地缓存:
   - bert-base-chinese  (~400MB, C1 底座)
   - bge-small-zh-v1.5  (~100MB, C4 向量)
```

**验证**：装完跑 `verify_env.py`，打印 torch 版本、`cuda.is_available()`、GPU 名称、两模型能否 `from_pretrained`。此脚本过了才动 C1/C4，避免装错 CPU 版空跑。

**取舍**：torch 走 `--index-url` 指定 cu124；不确定版本先 `pip index versions torch` 探 3.13 可装的最高版。装 torch 属中等风险（体积大、有网络依赖），执行前告知。

**降级**：若 cu124 装不上，退 cu121；若 CUDA torch 全失败，CPU 版也能跑（121 chunk + 564 样本规模小，CPU 慢但可行），但 GPU 优先。

---

## 第 2 段：C1 BERT-NER 微调

**目标**：用 564 条标注数据微调 `bert-base-chinese`，做成识别国土空间规划实体的本地 NER 模型，接入 Flask `/ner`。

```
ner_final.conll (564实体/479句/25409行)
     │
     ▼ ① prepare_ner_data.py  ── 清洗 + 划分
     │   · 剔除噪声：B-O(3)、DEGREE(1) → 并入 O
     │   · 标签锁定 5 类：SPATIAL/SURVEY/POLICY/FUNCTION/INDICATOR
     │   · 8:1:1 划分 → train/val/test.conll
     ▼
     ② train_ner.py  ── 微调
     │   · bert-base-chinese + TokenClassification 头
     │   · fp16, 3-5 epoch, batch 16
     │   · 存 models/bert-ner/
     ▼
     ③ eval_ner.py  ── seqeval 评估
     │   · test 集各标签 P/R/F1 + 整体 F1
     │   · 分层达标：主力类(SPATIAL+SURVEY) F1 ≥ 0.70
     │   · 小类如实报告，不设门槛
     ▼
     ④ server.py POST /ner  ── 集成
         · 加载 models/bert-ner/
         · {text} → [{entity, type, start, end}]
```

**标签分布（实测）**：SPATIAL 251 / SURVEY 230 / POLICY 38 / FUNCTION 31 / INDICATOR 10 + 噪声 B-O 3 / DEGREE 1。

**关键设计点**：
- **标签对齐**：`ner_annotate.py` 的 `ENTITY_TYPES` 同步——删 DEGREE、加 SURVEY，标注与训练用同一套标签。
- **子词对齐**：中文 BERT 按字切，标签也按字，天然对齐。标点/空格标签用 `-100` 忽略。
- **类别不均衡**：INDICATOR 仅 10 个，测试集可能只 1 个，F1 会抖。评估如实报告每类数量，不粉饰。分层达标（见成功标准）正是为此——主力类准即可，不被小类拖崩。
- **降级**：主力类 F1 < 0.5 则退 `extract_concepts.py`（LLM JSON），BERT 端点保留但不接主流程。

**测试**：`prepare_ner_data.py` 单测（划分比例、噪声剔除、标签集正确）；`/ner` 起服务后用 "城镇开发边界内应控制容积率" 验证输出实体正确。

---

## 第 3 段：C4 BERT 语义检索替代 TF-IDF

**目标**：用 `bge-small-zh-v1.5` 给 121 chunk 生成语义向量，替换 `/search` 的 TF-IDF 检索。

**关键洞察**（读 `server.py` 发现）：现有 `/search` 每次查询对每个 chunk 现算 `model.transform()`——**存了 `vector` BLOB 却没用**。C4 顺手修掉。

```
① embed_chunks.py  ── 离线编码（一次性）
│   · 读 SQLite 121 chunks 的 text
│   · bge-small-zh 编码 → 512维向量
│   · 写回 chunks.vector BLOB（复用现有字段）
│   · 加 meta 表标记 vector_type = 'bge-small-zh-v1.5'
▼
② server.py /search 改造  ── 在线检索
│   · 启动时把 121 向量读进内存（numpy 矩阵）
│   · query → bge 编码 → 与矩阵批量点积（已归一化，点积=余弦）
│   · Top-K 返回，出参不变（doc_title/page/text/score）
▼
③ B 后端 tfidf.ts 零改动（契约不变）
```

**设计要点**：
- **接口零破坏**：`/search` 请求/响应结构完全不变，替换而非重构。
- **bge 检索前缀**：查询侧加 `为这个句子生成表示以用于检索相关文章：`（bge 检索模式要求），chunk 侧不加。做错召回明显变差。
- **归一化**：bge 输出归一化后余弦 = 点积，`_cosine_similarity` 可简化。
- **闲聊阈值重标**：TF-IDF 的 `0.04` 阈值对 bge 无意义（bge 相似度普遍 0.3-0.7）。用几个已知问题实测重定阈值，否则闲聊拦截失灵。

**降级**：保留 `tfidf_model.pkl` 和旧检索函数，config 加 `RETRIEVAL_MODE = 'bge' | 'tfidf'`，bge 出问题一键切回。

**测试**：`embed_chunks.py` 验证 121 向量全部写入且维度 512；`/search` 用 3-5 个已知问题对比 bge vs tfidf 的 Top-3 命中，人工判断质量。

---

## 第 4 段：整合、验证、交付边界

```
verify_env.py ✓ (地基, 两者前提)
   │
   ├── C1 ──► models/bert-ner/  ──► server.py POST /ner
   │
   └── C4 ──► chunks.vector(bge) ──► server.py /search 改造
                                         │
                              两端点同属一个 Flask 进程
                                         │
                              B 后端无感知（/search 契约不变，
                                          /ner 为新增可选能力）
```

**执行顺序**（有依赖）：
1. 环境地基 + `verify_env.py` 过 —— 不过则全停，先解决 torch
2. C1 和 C4 可并行（都依赖地基，彼此独立）
3. 各自 Flask 集成
4. 端到端：起 Flask，`/ner` 和 `/search` 都验证通过

**验证清单**（每步真跑，不靠推断）：
- `verify_env.py`：torch CUDA 可用 + 两模型可加载
- C1：`eval_ner.py` 输出每类 P/R/F1；`/ner` 对已知句子出正确实体
- C4：121 向量入库；`/search` 已知问题 bge vs tfidf 对比
- 集成：Flask 双端点起服务无报错

**交付边界（YAGNI，不做）**：
- ❌ OWL / PostGIS / PDF上传（后续 session）
- ❌ 训 BERT 底座、加 CRF 层（微调够用，数据量撑不起）
- ❌ Faiss/向量库（121 chunk，numpy 内存点积足够）
- ❌ 动前端、动 B 后端代码（契约不变）
- ❌ 4 本损坏数据字典 PDF 的 OCR（独立大任务，另议）

**未决小问题**：`DEEPSEEK_API_KEY` 明文在 `config.py`（虽在 .gitignore）。本次不改，记一笔——终期收尾建议挪进 `.env`。

---

## 新增/改动文件清单

| 文件 | 类型 | 用途 |
|------|------|------|
| `ml-service/verify_env.py` | 新增 | 环境验证：torch CUDA + 模型加载 |
| `ml-service/scripts/prepare_ner_data.py` | 新增 | NER 数据清洗 + 8:1:1 划分 |
| `ml-service/scripts/train_ner.py` | 新增 | bert-base-chinese 微调 |
| `ml-service/scripts/eval_ner.py` | 新增 | seqeval 评估 |
| `ml-service/scripts/embed_chunks.py` | 新增 | bge 编码 121 chunk 写回 SQLite |
| `ml-service/server.py` | 改动 | 新增 `/ner` 端点 + `/search` 改用 bge |
| `ml-service/scripts/ner_annotate.py` | 改动 | ENTITY_TYPES 对齐（删 DEGREE、加 SURVEY）|
| `ml-service/config.py` | 改动 | 加 `RETRIEVAL_MODE` 开关 |
| `ml-service/models/bert-ner/` | 产物 | 微调模型（不入 git，体积大）|
| `ml-service/requirements.txt` | 改动 | 加 torch/transformers/seqeval/sentence-transformers |
