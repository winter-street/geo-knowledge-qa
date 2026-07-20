"""NER 数据清洗 + 8:1:1 划分（锁定测试集版）"""
import os, sys, random
from collections import Counter

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "output")
TEST_LOCK = os.path.join(OUTPUT_DIR, "test_locked.conll")
VALID_LABELS = {"O", "B-Mineral", "I-Mineral", "B-Rock", "I-Rock",
                "B-Structure", "I-Structure", "B-TimePeriod", "I-TimePeriod",
                "B-DepositType", "I-DepositType"}

def read_conll(path):
    sentences, current = [], []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                if current: sentences.append(current); current = []
            else:
                parts = line.split()
                if len(parts) == 2: current.append((parts[0], parts[1]))
    if current: sentences.append(current)
    return sentences

def clean_labels(sentences):
    cleaned, removed = [], 0
    for sent in sentences:
        new_sent = []
        for char, label in sent:
            if label not in VALID_LABELS:
                new_sent.append((char, "O")); removed += 1
            else:
                new_sent.append((char, label))
        cleaned.append(new_sent)
    return cleaned, removed

def write_conll(sentences, path):
    with open(path, "w", encoding="utf-8") as f:
        for sent in sentences:
            for char, label in sent:
                f.write(f"{char} {label}\n")
            f.write("\n")

def count_entities(sentences):
    counter = Counter()
    for sent in sentences:
        for _, label in sent:
            if label.startswith("B-"): counter[label[2:]] += 1
    return counter

def main():
    src = os.path.join(OUTPUT_DIR, "ner_final.conll")
    sentences = read_conll(src)
    print(f"原始: {len(sentences)} 句")
    sentences, removed = clean_labels(sentences)
    print(f"清洗噪声标签: {removed} 个 → O")
    entities = count_entities(sentences)
    print(f"实体分布: {dict(entities)} (总 {sum(entities.values())})")

    random.seed(42)

    # 锁定测试集：首次保存 test_locked.conll，后续复用
    if os.path.exists(TEST_LOCK):
        print(f"\n[锁定] 复用测试集: {TEST_LOCK}")
        test = read_conll(TEST_LOCK)
        test_keys = set("".join(c for c, _ in s) for s in test)
        # 从总池中剔除测试句，剩余做 train/val
        pool = [s for s in sentences if "".join(c for c, _ in s) not in test_keys]
        random.shuffle(pool)
        n_val = int(len(pool) * 0.11)  # ≈ 10% of original
        train = pool[n_val:]
        val = pool[:n_val]
    else:
        random.shuffle(sentences)
        n = len(sentences)
        n_train = int(n * 0.8)
        n_val = int(n * 0.1)
        train = sentences[:n_train]
        val = sentences[n_train:n_train + n_val]
        test = sentences[n_train + n_val:]
        write_conll(test, TEST_LOCK)
        print(f"[锁定] 测试集已保存: {TEST_LOCK} ({len(test)}句)")

    print(f"划分: train={len(train)} val={len(val)} test={len(read_conll(TEST_LOCK))}")

    for name, data in [("train", train), ("val", val)]:
        path = os.path.join(OUTPUT_DIR, f"{name}.conll")
        write_conll(data, path)
        ent = count_entities(data)
        print(f"  {name}: {dict(ent)} (总 {sum(ent.values())})")

    test = read_conll(TEST_LOCK)
    write_conll(test, os.path.join(OUTPUT_DIR, "test.conll"))
    ent = count_entities(test)
    print(f"  test(锁定): {dict(ent)} (总 {sum(ent.values())})")

    all_labels = set()
    for s in train + val + test:
        for _, l in s: all_labels.add(l)
    unexpected = all_labels - VALID_LABELS
    if unexpected:
        print(f"WARNING: 发现意外标签 {unexpected}")
    else:
        print("标签集验证通过 ✓")

if __name__ == "__main__":
    main()
