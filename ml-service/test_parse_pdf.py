"""
parse_pdf.py 的 TDD 测试
验证：能正确解析 PDF，按页输出纯文本
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from config import PDF_FILES

def test_parse_pdf():
    """测试 parse_pdf 能解析第一份 PDF 并返回正确结构"""
    from scripts.parse_pdf import parse_pdf

    pdf_path = PDF_FILES[0]["path"]
    assert os.path.exists(pdf_path), f"PDF 文件不存在: {pdf_path}"

    result = parse_pdf(pdf_path)

    # 结构检查
    assert "title" in result, "缺少 title 字段"
    assert "total_pages" in result, "缺少 total_pages 字段"
    assert "pages" in result, "缺少 pages 字段"
    assert isinstance(result["pages"], list), "pages 应为列表"

    # 数据合理性
    assert result["total_pages"] > 0, "页数应 > 0"
    assert result["total_pages"] == len(result["pages"]), "total_pages 与 pages 数量不一致"

    # 每页结构
    first_page = result["pages"][0]
    assert "page_num" in first_page, "page 缺少 page_num"
    assert "text" in first_page, "page 缺少 text"
    assert isinstance(first_page["text"], str), "text 应为字符串"
    assert len(first_page["text"]) > 0, "第一页文本不应为空"

    # 打印验证信息
    print(f"[PASS] title: {result['title']}")
    print(f"[PASS] pages: {result['total_pages']}")
    print(f"[PASS] first page(500 chars): {first_page['text'][:500]}")
    print(f"[PASS] total chars: {sum(len(p['text']) for p in result['pages'])}")

    return True


if __name__ == "__main__":
    test_parse_pdf()
