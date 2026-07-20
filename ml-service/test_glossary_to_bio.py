"""
TDD：术语词典 → BIO 标注转换
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_glossary_to_bio():
    """测试术语词条转 BIO 格式"""
    from scripts.glossary_to_bio import glossary_to_bio

    terms = [
        {"name": "国土空间", "definition": "国家主权和主权权利管辖下的地域空间。"},
        {"name": "永久基本农田", "definition": "为保障国家粮食安全而确定的不得占用的耕地。"},
    ]

    bio_lines = glossary_to_bio(terms)

    assert len(bio_lines) > 0, "应产出标注行"
    assert "国 B-SPATIAL" in bio_lines or "国 B-" in bio_lines, "应标注实体开始"

    # 验证标注行格式：每行 "字 标签" 或空行
    for line in bio_lines.split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        assert len(parts) == 2, f"格式错误: {line}"
        tag = parts[1]
        assert tag in ["O"] or tag.startswith("B-") or tag.startswith("I-"), f"标签错误: {tag}"

    print(f"[PASS] lines: {len(bio_lines.split(chr(10)))}")
    print(bio_lines[:400])
    return True


def test_real_glossary():
    """用真实术语词典数据测试"""
    from scripts.glossary_to_bio import glossary_to_bio
    from scripts.extract_glossary import extract_terms
    from scripts.parse_pdf import parse_pdf

    pdf_path = os.environ.get("GEO_TEST_GLOSSARY_PDF")
    if not pdf_path:
        print("[SKIP] Set GEO_TEST_GLOSSARY_PDF to test with your own glossary PDF")
        return True
    parsed = parse_pdf(pdf_path)
    terms = extract_terms(parsed)[:30]  # 取前 30 条

    bio_lines = glossary_to_bio(terms)

    # 统计实体数
    b_count = sum(1 for l in bio_lines.split("\n") if "B-" in l)
    assert b_count >= 20, f"30 条术语至少 20 个 B- 标签: {b_count}"

    print(f"[PASS] terms: {len(terms)}, B- tags: {b_count}")
    return True


if __name__ == "__main__":
    test_glossary_to_bio()
    test_real_glossary()
