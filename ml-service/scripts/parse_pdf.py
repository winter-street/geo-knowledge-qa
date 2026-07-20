"""
PDF 解析脚本 —— 读取 PDF 文件，按页输出纯文本
"""
import pdfplumber
import os


def parse_pdf(pdf_path: str) -> dict:
    """
    解析 PDF 文件，返回按页组织的文本。

    Args:
        pdf_path: PDF 文件路径

    Returns:
        {
            "title": str,           # 文档标题（文件名）
            "total_pages": int,     # 总页数
            "pages": [
                {"page_num": 1, "text": "..."},
                ...
            ]
        }
    """
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF 文件不存在: {pdf_path}")

    title = os.path.splitext(os.path.basename(pdf_path))[0]
    pages = []

    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            text = page.extract_text()
            if text is None:
                text = ""
            cleaned = _clean_text(text)
            pages.append({"page_num": i, "text": cleaned})

    return {"title": title, "total_pages": len(pages), "pages": pages}


def _clean_text(text: str) -> str:
    """清洗文本：合并断行、去除多余空白"""
    lines = text.split("\n")
    cleaned_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped:
            cleaned_lines.append(stripped)

    result = "\n".join(cleaned_lines)
    while "  " in result:
        result = result.replace("  ", " ")
    while "\n\n\n" in result:
        result = result.replace("\n\n\n", "\n\n")

    return result


if __name__ == "__main__":
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from config import PDF_FILES

    for pdf_info in PDF_FILES:
        result = parse_pdf(pdf_info["path"])
        print(f"文档: {result['title']}")
        print(f"页数: {result['total_pages']}")
        print(f"首段: {result['pages'][0]['text'][:200]}...")
        print("---")
