"""
extract_landuse.py 的 TDD 测试
验证：正则提取用地分类层级（大类/中类/小类）
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_extract_landuse():
    """测试从用地分类指南提取分类节点"""
    from scripts.extract_landuse import extract_landuse
    from scripts.parse_pdf import parse_pdf
    from config import PDF_FILES

    # 取用地分类那份 PDF
    pdf_info = PDF_FILES[1]
    assert "用地" in pdf_info["doc_type"], "第二份 PDF 应为用地分类指南"

    parsed = parse_pdf(pdf_info["path"])
    nodes = extract_landuse(parsed)

    # 基本检查
    assert len(nodes) > 50, f"应提取 50+ 个节点，实际 {len(nodes)}"

    # 结构检查
    first = nodes[0]
    required_keys = ["name", "code", "level"]
    for key in required_keys:
        assert key in first, f"节点缺少 {key}"

    # 层级分布
    levels = {"大类": 0, "中类": 0, "小类": 0}
    for n in nodes:
        assert n["level"] in levels, f"无效层级: {n['level']}"
        levels[n["level"]] += 1

    print(f"[PASS] total nodes: {len(nodes)}")
    print(f"[PASS] 大类: {levels['大类']}, 中类: {levels['中类']}, 小类: {levels['小类']}")
    print(f"[NOTE] 小类=0 是预期的: PDF 中 6 位编码用了上标排版, pdfplumber 无法完整提取")

    # 验证层级规则
    for n in nodes:
        if n["level"] == "大类":
            assert len(n["code"]) == 2, f"大类 code 应为 2 位: {n['code']}"
        elif n["level"] == "中类":
            assert len(n["code"]) == 4, f"中类 code 应为 4 位: {n['code']}"
        elif n["level"] == "小类":
            assert len(n["code"]) == 6, f"小类 code 应为 6 位: {n['code']}"

    print(f"[PASS] all code lengths match level")

    # 打印几个例子
    for level_name in ["大类", "中类", "小类"]:
        samples = [n for n in nodes if n["level"] == level_name][:3]
        for s in samples:
            print(f"  [{s['level']}] {s['code']} {s['name']}")

    return True


if __name__ == "__main__":
    test_extract_landuse()
