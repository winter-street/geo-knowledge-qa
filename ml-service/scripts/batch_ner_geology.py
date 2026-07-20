"""
批量地质 NER 标注 v2（JSON + 程序转 BIO + 缓存加速）
首次: 解析PDF + LLM标注 → ner_final.conll
重跑: 读缓存文本 → 跳过解析，直奔 LLM 标注
"""
import sys, os, time, json, re
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

from parse_pdf import parse_pdf
from config import PDF_FILES, LLM_CONFIG
import requests

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "output")
CACHE_FILE = os.path.join(OUTPUT_DIR, "parsed_texts.json")  # PDF文本缓存
os.makedirs(OUTPUT_DIR, exist_ok=True)

SEGMENT_CHARS = 800
MAX_SEGMENTS_PER_PDF = 15
WORKERS = 8
PRINT_LOCK = Lock()
FORCE_REPARSE = "--force" in sys.argv

ENTITY_TYPES_DESC = """- Mineral: 矿产名称（钒钛磁铁矿、钛铁矿、黄铜矿、铅锌矿、磁铁矿等）
- Rock: 岩石名称（辉长岩、玄武岩、花岗岩、石灰岩、片麻岩、大理岩、石英岩等）
- Structure: 地质构造（断裂带、褶皱、背斜、韧性剪切带、构造混杂岩带、断隆带等）
- TimePeriod: 地质年代（二叠纪、燕山期、侏罗纪、白垩纪、元古代、古生代、石炭纪等）
- DepositType: 矿床成因类型（岩浆分异型、热液充填型、沉积变质型、岩浆型等）"""


def segment_text(text: str, max_chars: int = 800) -> list:
    segments, current = [], ""
    for sent in text.replace("\n", "").split("。"):
        sent = sent.strip() + "。"
        if len(sent) <= 2:
            continue
        if len(current) + len(sent) > max_chars and len(current) >= 100:
            segments.append(current)
            current = sent
        else:
            current += sent
    if len(current) >= 30:
        segments.append(current)
    return segments


def load_or_parse_pdfs():
    """读缓存或解析 PDF，返回 [(pdf_info, title, pages_text), ...]"""
    if os.path.exists(CACHE_FILE) and not FORCE_REPARSE:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            cached = json.load(f)
        # 验证缓存的 PDF 数量和 config 一致
        cached_paths = {c["path"] for c in cached}
        config_paths = {p["path"] for p in PDF_FILES}
        if cached_paths == config_paths:
            print(f"[缓存] 从 {CACHE_FILE} 加载 {len(cached)} 篇文本 (--force 强制重解析)")
            return [(next(p for p in PDF_FILES if p["path"] == c["path"]), c["title"], c["text"])
                    for c in cached]

    print(f"[解析] {'强制重解析' if FORCE_REPARSE else '首次，生缓存'} ...")
    t0 = time.time()
    docs = []
    cache_data = []

    with ThreadPoolExecutor(max_workers=min(len(PDF_FILES), 4)) as pool:
        futures = {pool.submit(parse_pdf, p["path"]): p for p in PDF_FILES}
        for f in as_completed(futures):
            pdf = futures[f]
            try:
                doc = f.result()
                text = "".join(pg["text"] for pg in doc["pages"])[300:]  # 跳过封面
                docs.append((pdf, doc["title"], text))
                cache_data.append({"path": pdf["path"], "title": doc["title"], "text": text})
                print(f"  {os.path.basename(pdf['path'])[:50]}... {doc['total_pages']}页")
            except Exception as e:
                print(f"  {os.path.basename(pdf['path'])[:50]}... 失败: {e}")

    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache_data, f, ensure_ascii=False)
    print(f"  解析耗时: {time.time()-t0:.1f}s | 缓存已保存至 {CACHE_FILE}")
    return docs


def extract_entities_json(text: str) -> list:
    prompt = f"""你是地质找矿领域专家。从以下文本中提取所有命名实体，输出 JSON 数组。

## 实体类型
{ENTITY_TYPES_DESC}

## 文本
{text}

## 输出格式
只输出一个 JSON 数组: [{{"name":"实体名","type":"Rock"}}, ...]
只输出 JSON 数组，不要任何其他文字。"""

    for attempt in range(3):
        try:
            resp = requests.post(
                f"{LLM_CONFIG['base_url']}/chat/completions",
                headers={"Content-Type": "application/json",
                         "Authorization": f"Bearer {LLM_CONFIG['api_key']}"},
                json={"model": LLM_CONFIG["model"], "messages": [
                    {"role": "system", "content": "你是一个地质实体提取器。严格输出 JSON 数组，不要其他内容。"},
                    {"role": "user", "content": prompt}],
                    "temperature": 0.1, "max_tokens": 2048,
                    "response_format": {"type": "json_object"}},
                timeout=60)
            if resp.status_code != 200:
                if attempt < 2: time.sleep(2 * (attempt + 1))
                continue

            raw = resp.json()["choices"][0]["message"]["content"].strip()
            m = re.search(r'\[.*\]', raw, re.DOTALL)
            if m:
                entities = json.loads(m.group(0))
                if isinstance(entities, list):
                    return [{"name": e["name"].strip(), "type": e["type"].strip()}
                            for e in entities if isinstance(e, dict) and "name" in e and "type" in e
                            and e.get("type") in ("Mineral", "Rock", "Structure", "TimePeriod", "DepositType")]
            try:
                obj = json.loads(raw)
                items = obj.get("entities", obj) if isinstance(obj, dict) else obj
                return [{"name": e["name"].strip(), "type": e["type"].strip()} for e in items
                        if isinstance(e, dict) and e.get("type") in
                        ("Mineral", "Rock", "Structure", "TimePeriod", "DepositType")]
            except json.JSONDecodeError:
                pass
        except Exception:
            if attempt < 2: time.sleep(2 * (attempt + 1))
    return []


def entities_to_bio(text: str, entities: list) -> list:
    """实体列表转 BIO：精确匹配全部出现 + 句号切短句"""
    tags = ["O"] * len(text)
    missed = 0
    for ent in entities:
        name = ent["name"].strip()
        etype = ent["type"]
        found = False
        pos = 0
        while True:
            idx = text.find(name, pos)
            if idx == -1:
                break
            found = True
            if idx < len(tags):
                tags[idx] = f"B-{etype}"
                for j in range(idx + 1, min(idx + len(name), len(tags))):
                    if tags[j] == "O":
                        tags[j] = f"I-{etype}"
            pos = idx + 1
        if not found:
            missed += 1

    # 按标点切短句
    sentences, current = [], []
    for i, c in enumerate(text):
        current.append((c, tags[i]))
        if c in "。！？；\n" and len(current) >= 10:
            sentences.append(current)
            current = []
    if current:
        sentences.append(current)
    return sentences


def bio_to_conll(sentences: list) -> str:
    lines = []
    for sent in sentences:
        for char, tag in sent:
            lines.append(f"{char} {tag}")
        lines.append("")
    return "\n".join(lines).strip()


def annotate_one(task):
    idx, pdf_name, seg = task
    try:
        t0 = time.time()
        entities = extract_entities_json(seg)
        sentences = entities_to_bio(seg, entities)
        elapsed = time.time() - t0
        with PRINT_LOCK:
            types = {}
            for e in entities: types[e["type"]] = types.get(e["type"], 0) + 1
            ts = " ".join(f"{t}:{c}" for t, c in sorted(types.items())) if types else "-"
            print(f"  [{idx}] {pdf_name}: {len(seg)}字 → {len(entities)}实体 [{ts}] ({elapsed:.1f}s)")
        return (idx, sentences, len(entities), None)
    except Exception as e:
        with PRINT_LOCK: print(f"  [{idx}] {pdf_name}: 失败 ({e})")
        return (idx, entities_to_bio(seg, []), 0, str(e))


def main():
    print(f"=== 批量地质 NER 标注 v2 === 段长:{SEGMENT_CHARS} 线程:{WORKERS} 缓存:{'OFF(force)' if FORCE_REPARSE else 'ON'}")
    docs = load_or_parse_pdfs()

    # 分段
    all_tasks = []
    for pdf_info, title, text in docs:
        name = os.path.basename(pdf_info["path"])[:40]
        for seg in segment_text(text, SEGMENT_CHARS)[:MAX_SEGMENTS_PER_PDF]:
            all_tasks.append((len(all_tasks) + 1, name, seg))
    print(f"\n[LLM标注] {len(all_tasks)} 段, {WORKERS} 线程并发")

    # 并发标注
    t0 = time.time()
    results, done = {}, 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(annotate_one, t): t for t in all_tasks}
        for f in as_completed(futures):
            idx, sentences, n, err = f.result()
            results[idx] = (sentences, n, err)
            done += 1
            if done % 20 == 0 or done == len(all_tasks):
                total = sum(r[1] for r in results.values())
                print(f"  --- {done}/{len(all_tasks)} (累计 {total} 实体) ---")

    elapsed = time.time() - t0
    total_e = sum(r[1] for r in results.values())
    fails = sum(1 for r in results.values() if r[2])
    print(f"  耗时: {elapsed:.1f}s | 实体: {total_e} | 失败: {fails}")

    # 合并保存
    all_sentences = []
    for idx in sorted(results.keys()):
        all_sentences.extend(results[idx][0])
    conll = bio_to_conll(all_sentences)

    path = os.path.join(OUTPUT_DIR, "ner_final.conll")
    with open(path, "w", encoding="utf-8") as f:
        f.write(conll)

    b_count = sum(1 for l in conll.split("\n") if " B-" in l)
    types = {}
    for l in conll.split("\n"):
        if " B-" in l:
            t = l.split("B-")[-1].strip()
            types[t] = types.get(t, 0) + 1

    print(f"\n{'='*50}")
    print(f"输出: {path}")
    print(f"B-标签: {b_count} (目标>=500)  分布: {types}")
    print(f"{'✅ 够微调了!' if b_count >= 500 else f'⚠️ 还差{500-b_count}个'}")
    print(f"\n续跑: python scripts/prepare_ner_data.py && python scripts/train_ner.py && python scripts/eval_ner.py")


if __name__ == "__main__":
    main()
