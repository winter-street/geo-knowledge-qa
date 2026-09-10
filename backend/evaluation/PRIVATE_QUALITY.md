# 真实私有质量评测

真实题目、答案、证据正文、文档标题、坐标、数据库、模型回答和人工审核记录禁止提交 Git。所有资产只保存在 `backend/evaluation/private/`，该目录已被 `.gitignore` 排除。

## 1. 冻结数据并导出证据包

停止继续导入 PDF、重建 SQLite 或重建 Neo4j 后，启动 Neo4j，执行：

```powershell
npm.cmd --prefix backend run evaluation:curate -- export `
  --db ml-service/output/geo_knowledge.db `
  --output backend/evaluation/private
```

输出包括：

- `snapshot.private.json`：SQLite 哈希、文档/切片统计、规范化文档指纹、重复组和 Neo4j 规模，不含标题和路径。
- `evidence-packs.private.jsonl`：最小正文证据、页码、chunk ID、实体和 KG 路径。
- `candidate-pool.private.jsonl`：首次导出时创建的空候选池；重复导出不会覆盖人工内容。

证据包初始为 `privacyReviewed=false`。人工检查后，才可将证据包改为 `true`。本轮不使用空间题，也不导出空间题占位。

`prompts` 命令允许输入文件同时包含已审核和未审核证据包：只使用 `privacyReviewed=true` 的记录，跳过其余记录并在命令输出中报告数量。拒答和多轮提示同样只能引用已审核记录；证据不足时命令会失败，不会静默降级。

## 2. 生成独立 AI 提示

只有所有证据包完成隐私复核后，执行：

```powershell
npm.cmd --prefix backend run evaluation:curate -- prompts `
  --evidence backend/evaluation/private/evidence-packs.private.jsonl `
  --output backend/evaluation/private/candidate-prompts.private.jsonl
```

把提示复制到独立 AI 对话中。AI 只能生成候选，不能标记 `accepted`，也不能独立确认拒答题“知识库不存在答案”。不要发送完整 PDF、真实路径、API Key 或精确敏感坐标。

目标候选数量：55 supported、15 refusal、15 组三轮对话。supported 覆盖：

- `document_fact`
- `kg_relation`
- `entity_detail`
- `region_comparison`
- `hybrid`

多轮场景覆盖代词追问、双实体比较、实体歧义、KG 关系追问和中途换主题。

将 AI 输出整理到 `candidate-pool.private.jsonl`，每条记录的初始状态应为 `candidate` 或 `human_review`。

## 3. CSV 批量人工审核

生成包含证据正文的本地审核表：

```powershell
npm.cmd --prefix backend run evaluation:curate -- review-export `
  --candidates backend/evaluation/private/candidate-pool.private.jsonl `
  --evidence backend/evaluation/private/evidence-packs.private.jsonl `
  --output backend/evaluation/private/candidate-review.private.csv
```

CSV 包含问题、类别、预期工具、证据包 ID、文档指纹、页码、chunk ID、supportingText、实体/KG 数量、隐私状态和审核字段。CSV 只在本地私有目录使用。

人工填写 `review_status`、`reviewer`、`review_notes`。审核状态只能是 `candidate`、`human_review`、`accepted` 或 `rejected`。拒答题必须先用全文、别名和 Neo4j 查询确认缺失，不能仅凭 AI 建议接受。

审核完成后回填候选 JSONL：

```powershell
npm.cmd --prefix backend run evaluation:curate -- review-import `
  --csv backend/evaluation/private/candidate-review.private.csv `
  --output backend/evaluation/private/candidate-pool.reviewed.private.jsonl
```

## 4. 验证和冻结

```powershell
npm.cmd --prefix backend run evaluation:curate -- validate `
  --candidates backend/evaluation/private/candidate-pool.reviewed.private.jsonl `
  --snapshot backend/evaluation/private/snapshot.private.json `
  --evidence backend/evaluation/private/evidence-packs.private.jsonl

npm.cmd --prefix backend run evaluation:curate -- freeze `
  --candidates backend/evaluation/private/candidate-pool.reviewed.private.jsonl `
  --snapshot backend/evaluation/private/snapshot.private.json `
  --evidence backend/evaluation/private/evidence-packs.private.jsonl `
  --output backend/evaluation/private/suite.json `
  --label geology-private-holdout-v1
```

冻结门禁要求：30 supported、10 refusal、10 组三轮；五类 supported 均覆盖；拒答包含全文和知识图谱缺失检查；难度约 30/50/20；单一文档最多贡献 20% supported 题；文档指纹、实体 ID、KG 路径和 `snapshotHash` 全部有效。`suite.json` 不包含 supportingText、goldClaims、页码和审核信息，`freeze-manifest.private.json` 绑定 `snapshotHash`、SQLite 哈希和 `suiteHash`。

数据快照发生变化后必须重新导出证据包并升级题集版本，不能沿用旧 `suiteHash`。

## 5. 运行质量评测

先用少量私有 smoke 子集检查服务和费用，再使用同一冻结题集运行 baseline 与 candidate。两次运行必须使用相同 SQLite、Neo4j、模型和参数，并确认 `suiteHash` 一致。人工盲审完成前，公开汇总的 `humanReviewStatus` 保持 `pending`；没有第二位审核者时只写“人工复核”。
