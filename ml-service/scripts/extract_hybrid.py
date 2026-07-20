"""
混合实体提取脚本 —— BERT-NER + 词典 双路实体发现 + LLM 关系提取

架构:
  1. 词典正则 → 主力实体发现（312词，类型准确）
  2. BERT-NER 补漏 → 在词典覆盖弱的页面运行，发现未知实体
  3. LLM 关系提取 → 合并后的实体列表送 LLM 判断关系
"""
import json
import os
import sys
import re
import time
import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock, RLock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

from dict_ner_geology import hardcoded_entities, build_regex_patterns, LABEL_MAP
try:
    from entity_quality import validate_entity
except ModuleNotFoundError:
    from scripts.entity_quality import validate_entity
from extract_concepts import call_llm, parse_llm_response

_print_lock = Lock()
_relation_cache_lock = RLock()
_relation_cache = None
RELATION_CACHE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "output", "relation_cache.json"
)

# BERT-NER 模型（惰性加载，全局复用）
_ner_model = None
_ner_tokenizer = None
_ner_id2label = None
NER_MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "models", "bert-ner")

# 有效关系白名单：给定 (from_type, to_type) 只允许唯一的关系类型
RELATION_WHITELIST = {
    ("Mineral", "Rock"): "HOSTED_IN",
    ("Mineral", "Structure"): "CONTROLLED_BY",
    ("Mineral", "TimePeriod"): "FORMED_IN",
    ("Rock", "TimePeriod"): "BELONGS_TO",
    ("Mineral", "Mineral"): "ASSOCIATED_WITH",
    ("Rock", "Rock"): "ASSOCIATED_WITH",
    ("Structure", "Rock"): "CUTS",
    ("Rock", "Structure"): "CONTROLLED_BY",
}

ALLOWED_RELATIONS = [
    "HOSTED_IN", "CONTROLLED_BY", "FORMED_IN",
    "BELONGS_TO", "ASSOCIATED_WITH", "CUTS",
]


def _relation_cache_key(page_text: str, page_entities: list, llm_config: dict) -> str:
    """Keep cached relations tied to the exact text, entities, and model."""
    payload = {
        "text": page_text,
        "entities": sorted(
            {f"{entity['name']}|{entity['type']}" for entity in page_entities}
        ),
        "model": llm_config.get("model", ""),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _load_relation_cache() -> dict:
    global _relation_cache
    with _relation_cache_lock:
        if _relation_cache is not None:
            return _relation_cache
        try:
            with open(RELATION_CACHE_PATH, "r", encoding="utf-8") as f:
                _relation_cache = json.load(f)
            if not isinstance(_relation_cache, dict):
                _relation_cache = {}
        except (FileNotFoundError, json.JSONDecodeError):
            _relation_cache = {}
        return _relation_cache


def _get_cached_relations(cache_key: str) -> list | None:
    with _relation_cache_lock:
        cached = _load_relation_cache().get(cache_key)
        return cached if isinstance(cached, list) else None


def _store_cached_relations(cache_key: str, relations: list) -> None:
    """Persist each successful page so a long corpus run can resume safely."""
    with _relation_cache_lock:
        cache = _load_relation_cache()
        cache[cache_key] = relations
        os.makedirs(os.path.dirname(RELATION_CACHE_PATH), exist_ok=True)
        temp_path = RELATION_CACHE_PATH + ".tmp"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, separators=(",", ":"))
        for attempt in range(5):
            try:
                os.replace(temp_path, RELATION_CACHE_PATH)
                return
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.1 * (attempt + 1))


# ---------------------------------------------------------------------------
# BERT-NER 实体发现（补漏词典未覆盖的实体）
# ---------------------------------------------------------------------------

def _load_ner_model():
    """惰性加载 BERT-NER 模型（全局复用，只加载一次）"""
    global _ner_model, _ner_tokenizer, _ner_id2label
    if _ner_model is not None:
        return True
    if not os.path.exists(NER_MODEL_DIR):
        with _print_lock:
            print("[BERT-NER] 模型目录不存在，跳过: " + NER_MODEL_DIR)
        return False
    try:
        import torch
        from transformers import BertForTokenClassification, BertTokenizerFast
        os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
        _ner_tokenizer = BertTokenizerFast.from_pretrained(NER_MODEL_DIR)
        _ner_model = BertForTokenClassification.from_pretrained(NER_MODEL_DIR)
        _ner_model.eval()
        _ner_id2label = _ner_model.config.id2label
        with _print_lock:
            print(f"[BERT-NER] 模型已加载: {NER_MODEL_DIR}")
        return True
    except Exception as e:
        with _print_lock:
            print(f"[BERT-NER] 加载失败: {e}")
        return False


def _extract_entities_bert(text: str) -> list:
    """用 BERT-NER 从文本中提取地质实体。

    仅在词典覆盖不足时作为补漏使用，返回少量高质量实体。
    每个实体包含: name, type, char_start, char_end
    """
    import torch
    if not _load_ner_model():
        return []

    chars = list(text)
    if len(chars) == 0:
        return []

    # BERT tokenizer 限制 512 tokens，取前 ~450 字符
    chars = chars[:450]

    encoding = _ner_tokenizer(
        chars, is_split_into_words=True,
        padding=True, truncation=True, return_tensors="pt",
    )

    with torch.no_grad():
        outputs = _ner_model(**encoding)
        preds = outputs.logits.argmax(-1)[0].tolist()

    entities = []
    current = None
    for i, (char, pred_id) in enumerate(zip(chars, preds)):
        label = _ner_id2label.get(pred_id, "O")
        if label.startswith("B-"):
            if current:
                entities.append(current)
            etype = label[2:]
            current = {"name": char, "type": etype, "start": i, "end": i + 1}
        elif label.startswith("I-") and current and label[2:] == current["type"]:
            current["name"] += char
            current["end"] = i + 1
        else:
            if current:
                entities.append(current)
                current = None
    if current:
        entities.append(current)

    # 过滤：去掉太短、含数字、含标点的碎片
    cleaned = []
    for e in entities:
        validation = validate_entity(e["name"], e["type"])
        if not validation.valid:
            continue
        name = validation.name
        # 补全描述：实体所在位置前后 ~50 字
        ctx_start = max(0, e["start"] - 50)
        ctx_end = min(len(chars), e["end"] + 50)
        context = " ".join("".join(chars[ctx_start:ctx_end]).split())
        cleaned.append({"name": name, "type": e["type"], "description": context})

    return cleaned


# ---------------------------------------------------------------------------
# 实体发现（词典正则扫描）
# ---------------------------------------------------------------------------

def _scan_page(text: str, patterns: dict) -> list:
    """用预编译正则扫描单页文本，返回实体列表。

    每个实体包含:
      - name: 匹配的实体名称
      - type: Mineral / Rock / Structure / TimePeriod / DepositType
      - description: 匹配位置前后各 ~50 字的上下文
    """
    found = []
    seen = set()

    for etype, pat in sorted(patterns.items()):
        for m in pat.finditer(text):
            name = m.group()
            if name in seen:
                continue
            seen.add(name)

            # 提取 ~100 字上下文（前后各 ~50 字）
            ctx_start = max(0, m.start() - 50)
            ctx_end = min(len(text), m.end() + 50)
            context = text[ctx_start:ctx_end].strip()
            # 清理换行/多余空白
            context = " ".join(context.split())

            found.append({
                "name": name,
                "type": etype,
                "description": context,
            })

    return found


# ---------------------------------------------------------------------------
# 关系提取（LLM）
# ---------------------------------------------------------------------------

def _build_relation_prompt(text: str, entities: list) -> str:
    """构建紧凑的关系提取 prompt —— 只问关系，不重新发现实体。"""
    entity_lines = "\n".join(f"  - {e['name']} ({e['type']})" for e in entities)

    return f"""你是一位地质找矿领域专家。请从以下文本中提取地质实体之间的**关系**。

文本：
---
{text}
---

文本中已发现的实体列表：
{entity_lines}

请输出 JSON（只输出 JSON，不要额外解释）：
{{
  "relations": [
    {{"from": "实体A", "relation": "HOSTED_IN", "to": "实体B"}}
  ]
}}

有效关系类型说明：
- HOSTED_IN: 矿产赋存于岩石中
- CONTROLLED_BY: 矿产/岩石受构造控制
- FORMED_IN: 矿产形成于某地质年代
- BELONGS_TO: 岩石属于某地质年代/地层
- ASSOCIATED_WITH: 共生伴生关系
- CUTS: 构造切穿岩石

规则：
1. 只从上面"已发现的实体列表"中选用实体来构建关系，不要引入新实体
2. 每种关系必须在原文中有明确依据
3. 如果原文中没有明确的关系，返回 {{"relations": []}}
4. 每个关系对象必须包含 from / relation / to 三个字段"""


def _extract_relations_for_page(page_text: str, page_num: int, page_entities: list,
                                 llm_config: dict, concept_type_map: dict) -> list:
    """Extract and validate relationships for one page, reusing durable cache hits."""
    cache_key = _relation_cache_key(page_text, page_entities, llm_config)
    cached = _get_cached_relations(cache_key)
    if cached is not None:
        with _print_lock:
            print(f"  Page {page_num}: relation cache hit, reused {len(cached)} relations")
        return cached

    prompt = _build_relation_prompt(page_text, page_entities)

    try:
        raw = call_llm(prompt, llm_config)
        result = parse_llm_response(raw)
        raw_relations = result.get("relations", [])
    except Exception as e:
        with _print_lock:
            print(f"  第{page_num}页: LLM 调用失败 - {e}")
        return []

    # 白名单过滤
    valid = []
    for r in raw_relations:
        from_name = r.get("from", "").strip()
        to_name = r.get("to", "").strip()
        rel = r.get("relation", "").strip()

        if not (from_name and to_name and rel):
            continue

        from_type = concept_type_map.get(from_name)
        to_type = concept_type_map.get(to_name)

        if not from_type or not to_type:
            with _print_lock:
                print(f"  第{page_num}页: 跳过关系 \"{from_name}\" -> \"{to_name}\"（实体不在预发现列表中）")
            continue

        expected = RELATION_WHITELIST.get((from_type, to_type))
        if expected and rel == expected:
            valid.append({"from": from_name, "relation": rel, "to": to_name})
        else:
            with _print_lock:
                print(f"  第{page_num}页: 过滤 [{from_type}]{from_name} -[{rel}]-> [{to_type}]{to_name}（期望: {expected}）")

    with _print_lock:
        print(f"  第{page_num}页: {len(page_entities)} 实体, LLM 返回 {len(raw_relations)} 关系, 白名单过滤后 {len(valid)} 关系")

    _store_cached_relations(cache_key, valid)
    return valid


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

def extract_hybrid(parsed_doc: dict, llm_config: dict, dry_run: bool = False) -> dict:
    """混合实体提取 —— 词典正则扫描 + LLM 关系提取。

    Args:
        parsed_doc: parse_pdf() 的输出
                    格式: {"title": str, "total_pages": int,
                           "pages": [{"page_num": int, "text": str}, ...]}
        llm_config: LLM 配置字典（api_key, base_url, model, temperature, max_tokens）
        dry_run:    True 时跳过所有 LLM 调用

    Returns:
        {
          "concepts": [{"name": str, "type": str, "description": str}, ...],
          "relations": [{"from": str, "relation": str, "to": str}, ...]
        }
    """
    # ---- Step 1: 加载实体词典 & 编译正则 ----
    entity_dict = hardcoded_entities()
    patterns = build_regex_patterns(entity_dict)
    print(f"[实体发现] 词典 {len(entity_dict)} 项, {len(patterns)} 类型")

    # ---- Step 2: 逐页扫描实体 ----
    all_concepts = []
    seen_names = set()

    for page in parsed_doc["pages"]:
        text = page.get("text", "")
        page_num = page.get("page_num", 0)

        page_entities = _scan_page(text, patterns)
        for ent in page_entities:
            if ent["name"] not in seen_names:
                seen_names.add(ent["name"])
                all_concepts.append(ent)

        if page_entities:
            print(f"  第{page_num}页: 发现 {len(page_entities)} 个实体")

    print(f"[实体发现] 词典去重后共 {len(all_concepts)} 个唯一实体")
    for t in LABEL_MAP:
        n = sum(1 for c in all_concepts if c["type"] == t)
        if n:
            print(f"    {t}: {n}")

    # ---- Step 2.5: BERT-NER 补漏（词典覆盖弱的页面） ----
    _load_ner_model()
    if _ner_model is not None:
        dict_names = {c["name"] for c in all_concepts}
        bert_found = 0
        for page in parsed_doc["pages"]:
            text = page.get("text", "")
            page_num = page.get("page_num", 0)
            page_dict_count = sum(1 for c in all_concepts if c["name"] in text)
            # 只跑有地质信号但词典覆盖不全的页面（≥1 且 < 10）
            if page_dict_count < 10 and page_dict_count >= 1 and len(text) > 100:
                bert_ents = _extract_entities_bert(text)
                new_count = 0
                for ent in bert_ents:
                    name = ent["name"]
                    # 过滤：≥3 字符、不在词典中、属于地质五类
                    if len(name) >= 3 and name not in dict_names and ent["type"] in LABEL_MAP:
                        dict_names.add(name)
                        all_concepts.append(ent)
                        bert_found += 1
                        new_count += 1
                if new_count:
                    print(f"  第{page_num}页: BERT 补漏 {new_count} 个新实体")
        print(f"[BERT-NER] 补漏 {bert_found} 个新实体, 总计 {len(all_concepts)} 个唯一实体")
        for t in LABEL_MAP:
            n = sum(1 for c in all_concepts if c["type"] == t)
            if n:
                print(f"    {t}: {n}")
    else:
        print("[BERT-NER] 未加载，跳过补漏")

    if dry_run:
        print("[DRY RUN] 跳过 LLM 关系提取")
        return {"concepts": all_concepts, "relations": []}

    # ---- Step 3: 实体名→类型映射（用于关系过滤） ----
    concept_type_map = {c["name"]: c["type"] for c in all_concepts}

    # ---- Step 4: 对含 >=2 实体的页面并发调用 LLM ----
    relation_tasks = []
    for page in parsed_doc["pages"]:
        text = page.get("text", "")
        page_num = page.get("page_num", 0)
        page_entities = _scan_page(text, patterns)
        if len(page_entities) >= 2:
            relation_tasks.append((text, page_num, page_entities))

    if not relation_tasks:
        print("[关系提取] 无页面含 >=2 实体，跳过 LLM")
        return {"concepts": all_concepts, "relations": []}

    print(f"[关系提取] {len(relation_tasks)} 页含多实体, ThreadPoolExecutor(max_workers=4) 并发调用 LLM ...")

    all_relations = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        future_to_page = {}
        for text, page_num, page_entities in relation_tasks:
            future = pool.submit(
                _extract_relations_for_page,
                text, page_num, page_entities,
                llm_config, concept_type_map,
            )
            future_to_page[future] = page_num

        for future in as_completed(future_to_page):
            pn = future_to_page[future]
            try:
                result = future.result()
                all_relations.extend(result)
            except Exception as e:
                with _print_lock:
                    print(f"  第{pn}页: 线程异常 - {e}")

    # ---- Step 5: 关系去重 ----
    seen_rels = set()
    unique_relations = []
    for r in all_relations:
        key = (r["from"], r["relation"], r["to"])
        if key not in seen_rels:
            seen_rels.add(key)
            unique_relations.append(r)

    print(f"[完成] 总计 {len(all_concepts)} 实体, {len(unique_relations)} 关系（去重前 {len(all_relations)}）")
    return {"concepts": all_concepts, "relations": unique_relations}


# ---------------------------------------------------------------------------
# CLI 入口（测试用）
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from config import PDF_FILES, LLM_CONFIG
    from parse_pdf import parse_pdf

    pdf_info = PDF_FILES[0]
    title = os.path.basename(pdf_info["path"])
    print(f"=== 混合提取测试: {title} ===\n")

    parsed = parse_pdf(pdf_info["path"])
    result = extract_hybrid(parsed, LLM_CONFIG, dry_run=False)

    print(f"\n最终结果: {len(result['concepts'])} 实体, {len(result['relations'])} 关系")
    for c in result["concepts"][:10]:
        desc = c["description"][:60].replace("\n", " ")
        print(f"  [{c['type']}] {c['name']}: {desc}...")
    for r in result["relations"][:10]:
        print(f"  {r['from']} -[{r['relation']}]-> {r['to']}")
