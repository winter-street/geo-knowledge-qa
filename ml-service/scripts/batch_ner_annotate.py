"""
批量 NER 标注：对 PDF 全文分段，调 DeepSeek 标注，输出 CONLL 训练数据
"""
import sys
import os
import time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

from ner_annotate import annotate_text, bio_to_conll
from parse_pdf import parse_pdf
from config import LLM_CONFIG

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 第一份 PDF：编制指南
PDF_PATH = "D:/1GISwork/6-GISdevelop/data/samples/202009-自资部-市级国土空间总体规划编制指南（试行）（自然资办发[2020]46号）.pdf"

# 分段参数
SEGMENT_CHARS = 250   # 每段最多 250 字
MAX_SEGMENTS = 40     # 先标注 40 段（约 10000 字）做第一批

def segment_text(text: str, max_chars: int = 250) -> list:
    """将长文本按句号自然分段，每段不超过 max_chars"""
    segments = []
    current = ""
    for sent in text.replace("。", "。\n").split("\n"):
        sent = sent.strip()
        if not sent:
            continue
        if len(current) + len(sent) > max_chars and current:
            segments.append(current)
            current = sent
        else:
            current += sent
    if len(current) >= 30:
        segments.append(current)
    return segments


def main():
    print("=== 批量 NER 标注 ===")
    print(f"PDF: {os.path.basename(PDF_PATH)}")
    print(f"每段最大: {SEGMENT_CHARS} 字, 最多 {MAX_SEGMENTS} 段")

    # 解析 PDF
    parsed = parse_pdf(PDF_PATH)
    full_text = "\n".join(p["text"] for p in parsed["pages"])
    full_text = full_text.replace("\n", "")

    # 跳过前 1000 字（封面/前言）
    body_text = full_text[1000:]
    segments = segment_text(body_text, SEGMENT_CHARS)[:MAX_SEGMENTS]
    print(f"分段数: {len(segments)}")

    # 逐段标注
    all_sentences = []
    total_entities = 0

    for i, seg in enumerate(segments):
        print(f"  段 {i+1}/{len(segments)} ({len(seg)} 字)...", end=" ", flush=True)
        try:
            sentences = annotate_text(seg, LLM_CONFIG)
            entity_chars = sum(1 for s in sentences for c, t in s if t != "O")
            total_entities += entity_chars
            all_sentences.extend(sentences)
            print(f"{entity_chars} 个实体标注")
        except Exception as e:
            print(f"失败: {e}")
            all_sentences.append([])

        if i < len(segments) - 1:
            time.sleep(1)

    # 保存 CONLL
    conll = bio_to_conll(all_sentences)
    output_path = os.path.join(OUTPUT_DIR, "ner_train.conll")
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(conll)

    # 统计
    lines = conll.strip().split("\n")
    entity_lines = [l for l in lines if l and not l.startswith("#")]
    sent_count = len([l for l in lines if l == ""]) + 1
    print(f"\n=== 完成 ===")
    print(f"  句子数: {sent_count}")
    print(f"  总行数: {len(entity_lines)}")
    print(f"  实体字符标注: {total_entities}")
    print(f"  输出: {output_path}")


if __name__ == "__main__":
    main()
