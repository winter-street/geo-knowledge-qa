"""
LLM 辅助规划概念提取脚本
从编制指南中提取规划概念和关系（智谱 GLM-4.7-Flash）
"""
import json
import re
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
try:
    from entity_quality import validate_entity
except ModuleNotFoundError:
    from scripts.entity_quality import validate_entity

_print_lock = Lock()


# ---- 文本分段 ----

def split_into_sections(text: str, min_chars: int = 300,
                        max_chars: int = 2000) -> list:
    """
    将长文本按自然段落边界分段，每段控制在合理长度。
    """
    sections = []
    current = ""

    paragraphs = text.split("\n\n")

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        if len(current) + len(para) > max_chars and len(current) >= min_chars:
            sections.append(current.strip())
            current = para
        else:
            current += "\n\n" + para if current else para

    if len(current.strip()) >= 50:
        sections.append(current.strip())

    return sections


# ---- Prompt 构建 ----

ALLOWED_CONCEPT_TYPES = ["Mineral", "Rock", "Structure", "TimePeriod", "DepositType"]
ALLOWED_RELATIONS = ["HOSTED_IN", "CONTROLLED_BY", "FORMED_IN", "BELONGS_TO", "ASSOCIATED_WITH", "REFERENCES"]


def build_extraction_prompt(text: str) -> str:
    """构建发给 LLM 的提取 prompt"""
    types_str = ", ".join(ALLOWED_CONCEPT_TYPES)
    rels_str = ", ".join(ALLOWED_RELATIONS)
    return f"""你是一位地质找矿领域的专家。请从以下文本中提取地质实体和它们之间的关系。

文本：
---
{text}
---

请输出一个 JSON 对象，格式如下：
{{
  "concepts": [
    {{"name": "实体名称", "type": "Mineral", "description": "原文中的一句话描述"}}
  ],
  "relations": [
    {{"from": "实体A", "relation": "HOSTED_IN", "to": "实体B"}}
  ]
}}

规则：
1. concept.type 限用: {types_str}
   - Mineral: 矿产名称（如钒钛磁铁矿、钛铁矿）
   - Rock: 岩石名称（如辉长岩、玄武岩）
   - Structure: 地质构造（如断裂带、背斜）
   - TimePeriod: 地质年代（如二叠纪、燕山期）
   - DepositType: 矿床成因类型（如岩浆分异型）
2. relation 限用: {rels_str}
   - HOSTED_IN: 矿产赋存于岩石
   - CONTROLLED_BY: 矿产受构造控制
   - FORMED_IN: 矿产形成于某地质年代
   - BELONGS_TO: 岩石属于某地质年代
   - ASSOCIATED_WITH: 矿产共生伴生关系
   - REFERENCES: 文档引用实体
3. 只提取原文中明确出现的地质实体，不要编造
4. 如果文本中没有可提取的概念，返回空列表
5. 每个概念都要有 description（来自原文）
6. 【重要】concept.name 必须是简短的名词短语，不超过25个字，不能是完整句子"""


# ---- LLM 调用 ----

def call_llm(prompt: str, config: dict, max_retries: int = 3) -> str:
    """调用 LLM API（OpenAI 兼容格式），含限流重试"""
    api_key = config.get("api_key", "")
    if not api_key or "YOUR" in api_key:
        raise ValueError("LLM API key 未配置，请在 ml-service/config.py 中填写真实 key")

    url = f"{config['base_url']}/chat/completions"
    payload = {
        "model": config.get("model"),
        "messages": [
            {"role": "system", "content": "你是一位地质找矿专家，请严格按 JSON 格式输出。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": config.get("temperature", 0.1),
        "max_tokens": config.get("max_tokens", 2048),
        "response_format": {"type": "json_object"},
    }

    for attempt in range(max_retries):
        try:
            resp = requests.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
                json=payload,
                timeout=90,
            )

            if resp.status_code == 200:
                data = resp.json()
                return data["choices"][0]["message"]["content"]

            elif resp.status_code == 429:
                wait = (attempt + 1) * 5  # 5s, 10s, 15s
                print(f"(限流, 等待 {wait}s...)")
                time.sleep(wait)
                continue

            else:
                raise RuntimeError(f"API 返回 {resp.status_code}: {resp.text[:200]}")

        except requests.RequestException as e:
            if attempt < max_retries - 1:
                wait = (attempt + 1) * 2
                print(f"(网络错误, {wait}s 后重试: {e})")
                time.sleep(wait)
                continue
            raise RuntimeError(f"LLM API 调用失败 (已重试{max_retries}次): {e}")

    raise RuntimeError(f"LLM API 调用失败: 429 限流, 已重试{max_retries}次仍失败")


# ---- 响应解析 ----

def parse_llm_response(raw: str) -> dict:
    """解析 LLM 返回的 JSON（容错处理）"""
    raw = raw.strip()

    # 尝试直接解析
    try:
        return _validate_result(json.loads(raw))
    except (json.JSONDecodeError, ValueError):
        pass

    # 尝试从 code block 中提取
    code_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', raw, re.DOTALL)
    if code_match:
        try:
            return _validate_result(json.loads(code_match.group(1)))
        except (json.JSONDecodeError, ValueError):
            pass

    # 尝试从文本中提取 JSON 对象
    brace_match = re.search(r'\{.*\}', raw, re.DOTALL)
    if brace_match:
        try:
            return _validate_result(json.loads(brace_match.group(0)))
        except (json.JSONDecodeError, ValueError):
            pass

    # 尝试修复截断的 JSON
    repaired = _repair_truncated_json(raw)
    if repaired:
        try:
            return _validate_result(json.loads(repaired))
        except (json.JSONDecodeError, ValueError):
            pass

    # 失败：返回空结果
    print(f"[WARN] 无法解析 LLM 响应: {raw[:200]}...")
    return {"concepts": [], "relations": []}


def _repair_truncated_json(raw: str) -> str | None:
    """尝试修复被截断的 JSON：补缺失的 } ] 和逗号"""
    # 找到最后一个完整的 concept 或 relation 对象
    # 策略：从尾部回溯，找到最后一个 "}" 或 "]" ，补齐剩余

    # 1. 尝试在最后一个完整对象后截断并补全
    text = raw.strip()

    # 移除 markdown code block
    m = re.search(r'```(?:json)?\s*\n?(.*)', text, re.DOTALL)
    if m:
        text = m.group(1)

    # 找到最外层 { 和对应的 }
    # 简单策略：计算花括号/方括号深度，在尾部补齐
    depth_brace = 0
    depth_bracket = 0
    for ch in text:
        if ch == '{':
            depth_brace += 1
        elif ch == '}':
            depth_brace -= 1
        elif ch == '[':
            depth_bracket += 1
        elif ch == ']':
            depth_bracket -= 1

    if depth_brace <= 0 and depth_bracket <= 0:
        return None  # 不需要修复或者已经坏了

    # 在尾部补全
    repaired = text.rstrip(',\n\r\t ')
    # 移除尾部不完整的 fragment（最后一个逗号之后的不完整内容）
    last_comma = repaired.rfind(',')
    last_brace = repaired.rfind('}')
    last_bracket = repaired.rfind(']')

    if last_comma > max(last_brace, last_bracket):
        repaired = repaired[:last_comma]

    # 补齐缺失的括号
    repaired += ']' * depth_bracket
    repaired += '}' * depth_brace

    return repaired


def _validate_result(result: dict) -> dict:
    """验证并过滤 LLM 输出"""
    concepts = []
    for c in result.get("concepts", []):
        if not isinstance(c, dict):
            continue
        name = c.get("name", "").strip()
        ctype = c.get("type", "").strip()
        if not (name and ctype in ALLOWED_CONCEPT_TYPES):
            continue

        # 规则A: 含 4 位以上连续数字 → 编码碎片，丢弃
        if re.search(r'\d{4,}', name):
            continue

        # 规则B: 以非名词片段开头 → 原文残留，丢弃
        noise_prefixes = ['及其', '现行', '相关', '包括', '按照', '根据',
                          '以及', '其中', '主要', '一般', '具体', '例如']
        if any(name.startswith(p) for p in noise_prefixes):
            continue

        # 规则C: 两个概念粘连（如"物流仓储用地11仓储用地"）→ 丢弃
        if re.search(r'用地\d+.*用地', name) or re.search(r'分类\d+.*分类', name):
            continue

        # 清理末尾残留的编码数字（"物流仓储用地11" → "物流仓储用地"）
        name = re.sub(r'\d{3,}$', '', name).strip()

        validation = validate_entity(name, ctype)
        if not validation.valid:
            continue
        name = validation.name

        concepts.append({
            "name": name,
            "type": ctype,
            "description": c.get("description", "").strip(),
        })

    relations = []
    for r in result.get("relations", []):
        if not isinstance(r, dict):
            continue
        frm = r.get("from", "").strip()
        rel = r.get("relation", "").strip()
        to = r.get("to", "").strip()
        if frm and rel in ALLOWED_RELATIONS and to:
            relations.append({"from": frm, "relation": rel, "to": to})

    return {"concepts": concepts, "relations": relations}


# ---- 去重合并 ----

def merge_results(all_results: list) -> dict:
    """合并多个分段的结果，去重"""
    concept_map = {}   # name -> merged concept
    relation_set = set()  # (from, relation, to)

    for result in all_results:
        for c in result.get("concepts", []):
            name = c["name"]
            if name in concept_map:
                # 合并描述
                existing = concept_map[name]
                if c["description"] not in existing["description"]:
                    existing["description"] += "; " + c["description"]
            else:
                concept_map[name] = dict(c)

        for r in result.get("relations", []):
            key = (r["from"], r["relation"], r["to"])
            relation_set.add(key)

    return {
        "concepts": list(concept_map.values()),
        "relations": [{"from": f, "relation": r, "to": t}
                       for f, r, t in relation_set],
    }


# ---- 主入口 ----

def _extract_one_section(args):
    """提取单段概念（线程安全）"""
    i, total, section, prompt_template, llm_config = args
    try:
        prompt = build_extraction_prompt(section) if prompt_template is None else prompt_template(section)
        raw = call_llm(prompt, llm_config)
        result = parse_llm_response(raw)
        n_c = len(result["concepts"])
        n_r = len(result["relations"])
        with _print_lock:
            print(f"  段{i+1}/{total}: {len(section)} 字符 -> {n_c} 概念, {n_r} 关系")
        return result
    except Exception as e:
        with _print_lock:
            print(f"  段{i+1}/{total}: {len(section)} 字符 ... 失败: {e}")
        return {"concepts": [], "relations": []}


def extract_concepts(parsed_doc: dict, llm_config: dict,
                     dry_run: bool = False) -> dict:
    """
    从地质 PDF 中提取地质实体和关系（多线程并发版）。
    """
    full_text = "\n\n".join(p["text"] for p in parsed_doc["pages"])
    sections = split_into_sections(full_text)
    print(f"文本共 {len(full_text)} 字符，分为 {len(sections)} 段")

    if dry_run:
        print("[DRY RUN] 跳过 LLM 调用")
        for i, s in enumerate(sections):
            print(f"  段{i}: {len(s)} 字符")
        return {"concepts": [], "relations": []}

    # 多线程并发提取（6线程）
    t0 = time.time()
    tasks = [(i, len(sections), sec, None, llm_config) for i, sec in enumerate(sections)]
    all_results = []

    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(_extract_one_section, t): t for t in tasks}
        for f in as_completed(futures):
            all_results.append(f.result())

    elapsed = time.time() - t0

    merged = merge_results(all_results)
    print(f"合并后: {len(merged['concepts'])} 概念, {len(merged['relations'])} 关系 ({elapsed:.1f}s)")
    return merged


if __name__ == "__main__":
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from config import PDF_FILES, LLM_CONFIG
    from parse_pdf import parse_pdf

    # 取编制指南那份 PDF
    pdf_info = PDF_FILES[0]
    parsed = parse_pdf(pdf_info["path"])
    # dry_run=False 正式调用 LLM
    result = extract_concepts(parsed, LLM_CONFIG, dry_run=False)
    print(f"\n完成: {len(result['concepts'])} 概念, {len(result['relations'])} 关系")
    for c in result["concepts"][:10]:
        print(f"  [{c['type']}] {c['name']}: {c['description'][:60]}...")
