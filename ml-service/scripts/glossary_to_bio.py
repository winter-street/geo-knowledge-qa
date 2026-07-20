"""
术语词典 → BIO 标注转换
将 "术语名：定义" 格式的词条自动转为 BERT-NER 训练数据
"""
import os

# 术语名默认标注为 SPATIAL（国标术语多为空间管控概念）
DEFAULT_ENTITY_TYPE = "SPATIAL"


def glossary_to_bio(terms: list, entity_type: str = None) -> str:
    """
    将术语词条列表转为 BIO 格式标注文本。

    每个术语生成一条合成训练句：
        国_土_空_间_：_定_义_文_本...
        B  I  I  I  O  O  O  O  O

    Args:
        terms: [{name, definition}, ...]
        entity_type: 实体类型标签（默认 SPATIAL）

    Returns:
        BIO 格式字符串（句间空行分隔）
    """
    etype = entity_type or DEFAULT_ENTITY_TYPE
    sentences = []

    for t in terms:
        name = t.get("name", "").strip()
        definition = t.get("definition", "").strip()
        if not name or not definition:
            continue

        # 过滤太短或太长的术语名
        if len(name) < 2 or len(name) > 20:
            continue

        # 构造合成句: "{术语名}：{定义}"
        sentence = name + "：" + definition

        # BIO 标注: 术语名部分标注为 B-X, I-X, I-X...
        lines = []
        for i, char in enumerate(sentence):
            # 跳过空格
            if char == " ":
                continue

            if i < len(name):
                tag = f"B-{etype}" if i == 0 else f"I-{etype}"
            else:
                tag = "O"

            lines.append(f"{char} {tag}")

        sentences.append("\n".join(lines))

    return "\n\n".join(sentences)


def merge_conll_files(file1: str, file2: str, output: str):
    """合并两个 CONLL 文件"""
    with open(file1, "r", encoding="utf-8") as f:
        text1 = f.read().strip()
    with open(file2, "r", encoding="utf-8") as f:
        text2 = f.read().strip()
    with open(output, "w", encoding="utf-8") as f:
        f.write(text1 + "\n\n" + text2)
    return output


if __name__ == "__main__":
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from extract_glossary import extract_terms
    from parse_pdf import parse_pdf

    if len(sys.argv) < 2:
        raise SystemExit("Usage: python scripts/glossary_to_bio.py <glossary.pdf>")
    pdf_path = sys.argv[1]
    parsed = parse_pdf(pdf_path)
    terms = extract_terms(parsed)
    print(f"术语数: {len(terms)}")

    # 转换
    bio = glossary_to_bio(terms)
    output_path = os.path.join(os.path.dirname(__file__), "..", "output", "glossary_ner.conll")
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(bio)

    # 统计
    lines = bio.split("\n")
    b_count = sum(1 for l in lines if "B-" in l)
    total = sum(1 for l in lines if l.strip())

    print(f"产出: {len(lines)} 行, {b_count} 个实体, {total} 个标注行")
    print(f"保存到: {output_path}")

    # 合并到主训练数据
    existing = os.path.join(os.path.dirname(__file__), "..", "output", "ner_train.conll")
    merged_path = os.path.join(os.path.dirname(__file__), "..", "output", "ner_merged.conll")
    if os.path.exists(existing):
        merge_conll_files(existing, output_path, merged_path)
        print(f"合并: {merged_path}")
