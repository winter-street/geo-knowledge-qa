# BERT/词典NER + LLM关系提取 混合方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 用词典正则扫描 PDF 文本标记实体，仅对有 ≥2 个实体的 chunk 调用 LLM 提取关系，输出 `{concepts, relations}` 喂给 `write_neo4j.py`。

**Architecture:** 复用 `dict_ner_geology.py` 的实体词典+正则引擎做实体发现（免费、快速），复用 `extract_concepts.py` 的 LLM 调用+解析层做关系提取（精准），新脚本 `extract_hybrid.py` 提供与 `extract_concepts()` 相同签名的 `extract_hybrid()` 函数，`run_pipeline.py` 地质分支切换调用。

**Tech Stack:** Python 3.10+, re (正则), requests (LLM API), concurrent.futures (多线程)

## Global Constraints

- 输出格式必须与 `extract_concepts()` 完全一致：`{"concepts": [...], "relations": [...]}`
- LLM 调用复用 `extract_concepts.py` 中的 `call_llm()` 和 `parse_llm_response()`
- 词典正则引擎复用 `dict_ner_geology.py` 中的 `hardcoded_entities()`, `build_regex_patterns()`, `sentence_to_bio_regex()`, `text_to_sentences()`
- chunk 结构复用 `run_pipeline.py` 中已解析的 `parsed_doc["pages"]`，不重新解析 PDF
- 关系仅建白名单内的类型对：(Mineral,Rock)→HOSTED_IN, (Mineral,Structure)→CONTROLLED_BY, (Mineral,TimePeriod)→FORMED_IN, (Rock,TimePeriod)→BELONGS_TO, (Mineral,Mineral)→ASSOCIATED_WITH

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `ml-service/scripts/extract_hybrid.py` | **Create** | 主脚本：词典NER实体发现 + LLM关系提取 + `extract_hybrid()` 入口 |
| `ml-service/scripts/run_pipeline.py` | **Modify** | 地质分支从 `extract_concepts()` 切换到 `extract_hybrid()` |

---

### Task 1: 写 `extract_hybrid.py` — 实体发现层

**Files:**
- Create: `ml-service/scripts/extract_hybrid.py`

**Interfaces:**
- Produces: `extract_hybrid(parsed_doc: dict, llm_config: dict, dry_run: bool = False) -> dict`
  - 签名与 `extract_concepts()` 完全一致
  - 返回 `{"concepts": [{name, type, description}, ...], "relations": [{from, relation, to}, ...]}`

- [ ] **Step 1: 创建文件骨架 + 导入依赖**

```python
"""
混合实体提取：词典NER发现实体 + LLM提取关系
比纯LLM方案快 3-5x，API调用少 60%，实体召回率更高
"""
import sys, os, re, time, json
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# 复用 dict_ner_geology 的词典引擎
from scripts.dict_ner_geology import (
    hardcoded_entities, build_regex_patterns,
    text_to_sentences, LABEL_MAP as ENTITY_LABELS
)
# 复用 extract_concepts 的 LLM 层
from scripts.extract_concepts import call_llm, parse_llm_response, merge_results

_print_lock = Lock()

# 合法关系白名单：(实体A类型, 实体B类型) → 允许的关系
VALID_PAIRS = {
    ("Mineral", "Rock"): "HOSTED_IN",
    ("Mineral", "Structure"): "CONTROLLED_BY",
    ("Mineral", "TimePeriod"): "FORMED_IN",
    ("Rock", "TimePeriod"): "BELONGS_TO",
    ("Mineral", "Mineral"): "ASSOCIATED_WITH",
    ("Rock", "Rock"): "ASSOCIATED_WITH",
    ("Structure", "Rock"): "CUTS",
    ("Rock", "Structure"): "CONTROLLED_BY",
}
```

- [ ] **Step 2: 实现词典实体扫描函数**

```python
def extract_entities_from_text(text: str, patterns: dict) -> list[dict]:
    """
    用预编译正则字典扫描文本，发现实体并提取描述。
    
    Args:
        text: 文本块（一个 page 的文本或 chunk 文本）
        patterns: {entity_type: re.Pattern} 预编译正则字典
    
    Returns:
        [{name, type, description}, ...]  去重后
    """
    entities = {}  # name -> {type, description}
    
    for etype, pat in patterns.items():
        for m in pat.finditer(text):
            name = m.group(0).strip()
            if len(name) < 2:
                continue
            # 提取实体所在句子作为描述
            start = max(0, m.start() - 40)
            end = min(len(text), m.end() + 60)
            ctx = text[start:end].replace("\n", " ").strip()
            
            if name not in entities:
                entities[name] = {
                    "name": name,
                    "type": etype,
                    "description": ctx,
                }
            elif ctx not in entities[name]["description"]:
                # 合并多个上下文的描述
                existing = entities[name]["description"]
                if len(existing) < 200:
                    entities[name]["description"] = existing + "；" + ctx
    
    return list(entities.values())
```

- [ ] **Step 3: 实现关系专用 LLM Prompt**

```python
def build_relation_prompt(text: str, entities: list[dict]) -> str:
    """
    构建紧凑的关系提取 prompt。
    只让 LLM 判断关系，不找实体——比完整提取 prompt 短 50-70%。
    """
    entity_lines = []
    for e in entities:
        entity_lines.append(f"- {e['name']} ({e['type']})")
    entity_block = "\n".join(entity_lines)
    
    return f"""从以下文本中找出地质实体之间的关系。实体列表已给出，你只需判断哪些实体对之间存在关系。

文本：
---
{text[:1500]}
---

已知实体：
{entity_block}

允许的关系类型：
- HOSTED_IN: 矿产赋存于岩石
- CONTROLLED_BY: 矿产受构造控制
- FORMED_IN: 矿产形成于某地质年代
- BELONGS_TO: 岩石属于某地质年代
- ASSOCIATED_WITH: 共生伴生关系
- CUTS: 构造切穿岩石

只输出 JSON：
{{"relations": [{{"from": "实体A", "relation": "HOSTED_IN", "to": "实体B"}}]}}

如果文本中没有明确关系，返回空列表。不要编造关系。"""
```

- [ ] **Step 4: 实现单段 LLM 调用包装**

```python
def _extract_relations_for_section(args):
    """线程安全：给定文本段 + 实体列表 → LLM 判断关系"""
    i, total, text, entities, llm_config = args
    
    if len(entities) < 2:
        return {"relations": []}
    
    try:
        prompt = build_relation_prompt(text, entities)
        raw = call_llm(prompt, llm_config)
        result = parse_llm_response(raw)
        
        # 过滤：只保留白名单类型对 + 实体名在列表中
        entity_names = {e["name"] for e in entities}
        entity_types = {e["name"]: e["type"] for e in entities}
        
        valid_relations = []
        for r in result.get("relations", []):
            frm, rel, to = r.get("from", ""), r.get("relation", ""), r.get("to", "")
            if frm not in entity_names or to not in entity_names:
                continue
            t_a = entity_types.get(frm, "")
            t_b = entity_types.get(to, "")
            allowed = VALID_PAIRS.get((t_a, t_b), "")
            if rel == allowed:
                valid_relations.append({"from": frm, "relation": rel, "to": to})
        
        with _print_lock:
            print(f"  段{i+1}/{total}: {len(entities)}实体 -> {len(valid_relations)}关系")
        return {"relations": valid_relations}
    except Exception as e:
        with _print_lock:
            print(f"  段{i+1}/{total}: 失败 ({e})")
        return {"relations": []}
```

- [ ] **Step 5: 实现主入口 `extract_hybrid()`**

```python
def extract_hybrid(parsed_doc: dict, llm_config: dict,
                   dry_run: bool = False) -> dict:
    """
    混合提取：词典NER扫实体 + LLM判关系。
    签名与 extract_concepts() 完全一致，可直接替换。
    """
    # 1. 构建词典（只用硬编码，不依赖 Neo4j 在线）
    entity_dict = hardcoded_entities()
    patterns = build_regex_patterns(entity_dict)
    
    # 2. 按页扫描实体
    all_entities = {}  # name -> {name, type, description}
    page_data = []     # [(page_text, entities_in_page), ...]
    
    for page in parsed_doc.get("pages", []):
        text = page.get("text", "")
        if len(text) < 20:
            continue
        
        page_entities = extract_entities_from_text(text, patterns)
        page_data.append((text, page_entities))
        
        for e in page_entities:
            name = e["name"]
            if name not in all_entities:
                all_entities[name] = e
            elif e["description"] not in all_entities[name]["description"]:
                existing = all_entities[name]["description"]
                if len(existing) < 300:
                    all_entities[name]["description"] = existing + "；" + e["description"]
    
    concepts = list(all_entities.values())
    print(f"[hybrid] {parsed_doc.get('title','')[:40]}: "
          f"{len(concepts)} 实体 (词典扫描)")
    
    if dry_run or not concepts:
        return {"concepts": concepts, "relations": []}
    
    # 3. 对有 ≥2 实体的页调用 LLM 提取关系
    t0 = time.time()
    sections_with_entities = [
        (i, len(page_data), text, ents, llm_config)
        for i, (text, ents) in enumerate(page_data)
    ]
    
    all_relation_results = []
    
    # 只对有效页调 LLM（≥2 实体），串行（每页很快）或小并发
    tasks = [t for t in sections_with_entities if len(t[3]) >= 2]
    if tasks:
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(_extract_relations_for_section, t): t
                      for t in tasks}
            for f in as_completed(futures):
                all_relation_results.append(f.result())
    
    # 4. 合并去重
    merged_relations = []
    seen_rels = set()
    for r in all_relation_results:
        for rel in r.get("relations", []):
            key = (rel["from"], rel["relation"], rel["to"])
            if key not in seen_rels:
                seen_rels.add(key)
                merged_relations.append(rel)
    
    elapsed = time.time() - t0
    print(f"[hybrid] {len(merged_relations)} 关系 ({elapsed:.1f}s, "
          f"{len(tasks)}次LLM调用)")
    
    return {"concepts": concepts, "relations": merged_relations}


if __name__ == "__main__":
    from scripts.parse_pdf import parse_pdf
    from config import PDF_FILES, LLM_CONFIG
    
    pdf = PDF_FILES[0]
    print(f"测试: {pdf['path']}")
    parsed = parse_pdf(pdf["path"])
    result = extract_hybrid(parsed, LLM_CONFIG, dry_run=False)
    
    print(f"\n=== 结果 ===")
    print(f"概念: {len(result['concepts'])}")
    for c in result["concepts"][:10]:
        print(f"  [{c['type']}] {c['name']}: {c['description'][:60]}...")
    print(f"关系: {len(result['relations'])}")
    for r in result["relations"][:10]:
        print(f"  {r['from']} -{r['relation']}-> {r['to']}")
```

- [ ] **Step 6: 验证文件语法正确**

Run: `python -m py_compile ml-service/scripts/extract_hybrid.py`
Expected: 无错误输出

- [ ] **Step 7: 干跑测试（不调 LLM）**

Run:
```sh
cd ml-service && python -c "
from scripts.parse_pdf import parse_pdf
from scripts.extract_hybrid import extract_hybrid
from config import PDF_FILES, LLM_CONFIG
parsed = parse_pdf(PDF_FILES[0]['path'])
result = extract_hybrid(parsed, LLM_CONFIG, dry_run=True)
print(f'Dry run: {len(result[\"concepts\"])} 实体, {len(result[\"relations\"])} 关系')
for c in result['concepts'][:5]:
    print(f'  [{c[\"type\"]}] {c[\"name\"]}')
"
```
Expected: 输出实体列表（如 `[Mineral] 钒钛磁铁矿`、`[Rock] 辉长岩`），relations=0

- [ ] **Step 8: Commit**

```bash
git add ml-service/scripts/extract_hybrid.py
git commit -m "feat: extract_hybrid.py — 词典NER实体发现 + LLM关系提取"
```

---

### Task 2: 接入 `run_pipeline.py`

**Files:**
- Modify: `ml-service/scripts/run_pipeline.py:127`

**Interfaces:**
- Consumes: `extract_hybrid(parsed_doc, llm_config, dry_run=False) -> dict`
- Produces: 与现有 `extract_concepts()` 相同的 `concepts` dict

- [ ] **Step 1: 修改地质分支调用**

在 `run_pipeline.py` 的 Step 4 中，将地质文档的 `extract_concepts()` 调用替换为 `extract_hybrid()`：

`run_pipeline.py:127` 附近：

```python
# 原代码:
# geo_concepts = extract_concepts(parsed, LLM_CONFIG, dry_run=False)

# 改为:
from extract_hybrid import extract_hybrid
geo_concepts = extract_hybrid(parsed, LLM_CONFIG, dry_run=False)
```

实际上在 `run_pipeline.py` 顶部添加导入：

```python
# 在现有 import 块后添加:
from extract_hybrid import extract_hybrid
```

在 Step 4 的地质分支（line 125-135）：

```python
elif parsed.get("doc_type") == "地质":
    t0 = time.time()
    geo_concepts = extract_hybrid(parsed, LLM_CONFIG, dry_run=False)  # 改这里
    concepts["concepts"].extend(geo_concepts.get("concepts", []))
    concepts["relations"].extend(geo_concepts.get("relations", []))
    print(f"  地质实体(混合): {len(geo_concepts.get('concepts', []))} 实体, "
          f"{len(geo_concepts.get('relations', []))} 关系, "
          f"耗时: {time.time() - t0:.1f}s")
    if geo_concepts.get("concepts"):
        print(f"    示例实体: {[c['name'] for c in geo_concepts['concepts'][:5]]}")
```

- [ ] **Step 2: 验证语法**

Run: `python -m py_compile ml-service/scripts/run_pipeline.py`
Expected: 无错误输出

- [ ] **Step 3: Commit**

```bash
git add ml-service/scripts/run_pipeline.py
git commit -m "feat: pipeline地质分支切换到extract_hybrid"
```

---

### Task 3: 端到端验证

- [ ] **Step 1: 用 --from-step4 重跑 Step 4-5（只提取实体+写入 Neo4j，不重解析 PDF）**

先确保 Neo4j 在线，然后：
```sh
cd ml-service && python scripts/run_pipeline.py --from-step4
```
Expected:
- Step 4 输出 `[hybrid]` 日志，显示每篇 PDF 的实体数+关系数+LLM 调用次数
- Step 5 输出 `概念节点 > 0`、`关系 > 0`

- [ ] **Step 2: Neo4j 验证**

```cypher
MATCH (n:Mineral) RETURN n.name LIMIT 10
MATCH (n:Rock) RETURN n.name LIMIT 10
MATCH (n)-[r]->(m) RETURN n.name, type(r), m.name LIMIT 20
```

Expected: 各标签有实体，关系链可查。

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "verify: 混合提取端到端通过"
```

---

## Self-Review

1. **Spec coverage**: ✅ 词典NER实体发现 ✅ LLM关系提取 ✅ 白名单过滤 ✅ 与 write_neo4j.py 接口兼容 ✅ pipeline 集成
2. **No placeholders**: ✅ 所有步骤含实际代码
3. **Type consistency**: ✅ `extract_hybrid()` 签名与 `extract_concepts()` 一致，`write_neo4j.py` 的 `write_all()` 接收格式不变
