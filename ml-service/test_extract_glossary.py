"""
TDD 测试：从《国土空间规划术语》PDF 提取术语词条
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_extract_glossary_terms():
    """测试从术语词典 PDF 提取术语名+定义"""
    from scripts.extract_glossary import extract_terms
    from scripts.parse_pdf import parse_pdf

    pdf_path = "D:/1GISwork/6-GISdevelop/data/samples/2025.04.03-《国土空间规划术语》（征求意见稿）.pdf"
    parsed = parse_pdf(pdf_path)

    terms = extract_terms(parsed)

    # 应该提取 50+ 条术语（一本 31 页的术语词典）
    assert len(terms) >= 50, f"应提取 50+ 条术语，实际 {len(terms)}"

    # 每条术语必须有 name 和 definition
    for t in terms:
        assert "name" in t, f"术语缺少 name: {t}"
        assert "definition" in t, f"术语缺少 definition: {t}"
        assert len(t["name"]) > 0, "术语名不能为空"
        assert len(t["definition"]) > 10, f"定义过短: {t['name']}: {t['definition'][:50]}"
        assert "type" in t, "术语缺少 type"

    # 找几个已知的术语名验证
    names = [t["name"] for t in terms]
    expected = ["国土空间", "国土空间规划", "详细规划", "永久基本农田", "城镇开发边界"]
    found = [n for n in expected if n in names]
    print(f"[PASS] terms count: {len(terms)}")
    print(f"[PASS] expected terms found: {found}")
    print(f"[PASS] sample terms:")
    for t in terms[:10]:
        print(f"  [{t['type']}] {t['name']}: {t['definition'][:60]}...")

    return True


if __name__ == "__main__":
    test_extract_glossary_terms()
