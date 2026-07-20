"""合并所有 NER 数据源"""
import os
OUT = os.path.join(os.path.dirname(__file__), "..", "output")

def read_conll(p):
    sent = []; cur = []
    if not os.path.exists(p): return sent
    with open(p, encoding="utf-8") as f:
        for l in f.read().split("\n"):
            l = l.strip()
            if not l:
                if cur: sent.append(cur); cur = []
            else:
                parts = l.split()
                if len(parts) == 2: cur.append((parts[0], parts[1]))
        if cur: sent.append(cur)
    return sent

def write_conll(sent, p):
    with open(p, "w", encoding="utf-8") as f:
        for s in sent:
            for c, t in s: f.write(f"{c} {t}\n")
            f.write("\n")

# 合并所有
all_s = []
sources = {
    "ner_merged": os.path.join(OUT, "ner_merged.conll"),
    "survey": os.path.join(OUT, "survey_ner.conll"),
    "glossary": os.path.join(OUT, "glossary_ner.conll"),
}
for name, path in sources.items():
    sent = read_conll(path)
    all_s.extend(sent)
    b = sum(1 for s in sent for c, t in s if t.startswith("B-"))
    print(f"{name}: {len(sent)} 句, {b} 实体")

# 去重：按实体名去重
seen = set()
deduped = []
for s in all_s:
    key = "".join(c for c, t in s if t != "O")
    if key and key not in seen:
        seen.add(key)
        deduped.append(s)

final = os.path.join(OUT, "ner_final.conll")
write_conll(deduped, final)
b = sum(1 for s in deduped for c, t in s if t.startswith("B-"))
tot = sum(1 for s in deduped for c, t in s if t.strip())
print(f"\n去重后: {len(deduped)} 句, {b} 实体, {tot} 标注行")
print(f"文件: {final}")
print("够微调了！" if b >= 500 else f"还差 {500-b}")
