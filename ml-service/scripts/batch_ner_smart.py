"""
智能批量标注：只标含种子词典术语的段落（精准 + 省API调用）
"""
import sys, os, time, jieba
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))
from ner_annotate import annotate_text, bio_to_conll
from parse_pdf import parse_pdf
from config import LLM_CONFIG, PDF_FILES

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "output")
os.makedirs(OUT_DIR, exist_ok=True)

# 加载种子词典
def load_seed():
    terms = set()
    # 从 Neo4j 加载已有 Concept/LandUse 名
    from neo4j import GraphDatabase
    from config import NEO4J_CONFIG
    d = GraphDatabase.driver(NEO4J_CONFIG["uri"], auth=(NEO4J_CONFIG["user"], NEO4J_CONFIG["password"]))
    with d.session() as s:
        for r in s.run("MATCH (n:LandUse) RETURN n.name").data():
            terms.add(r["n.name"])
        for r in s.run("MATCH (n:Concept) RETURN n.name").data():
            if len(r["n.name"]) <= 15:  # 只要短术语
                terms.add(r["n.name"])
    d.close()
    return terms

seed = load_seed()
print(f"种子词典: {len(seed)} 条")

# 解析 config.py 中配置的第一份文档。
parsed = parse_pdf(PDF_FILES[0]["path"])
body = "\n".join(p["text"] for p in parsed["pages"])[500:]

# 分段
segments, current = [], ""
for sent in body.replace("。", "。\n").split("\n"):
    sent = sent.strip()
    if not sent: continue
    if len(current) + len(sent) > 1500 and current:
        segments.append(current); current = sent
    else: current += sent
if len(current) >= 30: segments.append(current)

# 预筛选：只标含种子词的段落
to_annotate = []
for seg in segments:
    tokens = set(w for w in jieba.cut(seg) if len(w) >= 2)
    if tokens & seed:
        to_annotate.append(seg)

print(f"预筛选: {len(segments)} -> {len(to_annotate)} 段")

# 标注
all_sentences = []
for i, seg in enumerate(to_annotate):
    print(f"  段{i+1}/{len(to_annotate)} ({len(seg)}字)...", end=" ", flush=True)
    try:
        sentences = annotate_text(seg, LLM_CONFIG)
        got = sum(1 for s in sentences for c, t in s if t != "O")
        all_sentences.extend(sentences)
        print(f"{got} 实体")
    except Exception as e:
        print(f"失败: {e}")
    if i < len(to_annotate) - 1: time.sleep(1)

# 合并到之前的数据
existing = os.path.join(OUT_DIR, "ner_merged.conll")
if os.path.exists(existing):
    with open(existing, encoding="utf-8") as f:
        old_lines = f.read().strip().split("\n")
    # 补解析旧数据
    old_sentences = []
    cur = []
    for l in old_lines:
        l = l.strip()
        if not l:
            if cur: old_sentences.append(cur); cur = []
        else:
            parts = l.split()
            if len(parts) == 2: cur.append((parts[0], parts[1]))
    if cur: old_sentences.append(cur)
    all_sentences = old_sentences + all_sentences

conll = bio_to_conll(all_sentences)
path = os.path.join(OUT_DIR, "ner_merged.conll")
with open(path, "w", encoding="utf-8") as f:
    f.write(conll)

b_count = sum(1 for l in conll.split("\n") if "B-" in l)
print(f"\n合并后: {b_count} 实体")
print(f"文件: {path}")
if b_count >= 500:
    print("够微调了！")
else:
    print(f"还差 {500 - b_count}")
