"""
从《国土空间规划术语》等术语词典 PDF 提取术语词条
格式: 术语名 → 定义段落 → 可选[注]/[来源]
"""
import re


def extract_terms(parsed_doc: dict) -> list:
    """
    从解析后的术语词典 PDF 中提取术语词条。

    术语词典的典型格式（TD/T 国标）：
        术语名（短行，5-25 字，纯中文）
        定义段（较长，缩进）
        [注] 补充说明（可选）
        [来源：GB/T xxxx-xxxx]（可选）

    Args:
        parsed_doc: parse_pdf 输出

    Returns:
        [{name, definition, type, source}, ...]
    """
    terms = []
    current_term = None
    current_def_parts = []
    current_source = ""
    started = False  # 等遇到第一个真正的术语章节才开始

    for page_num, page in enumerate(parsed_doc["pages"], start=1):
        text = page["text"]
        if not text:
            continue

        lines = text.split("\n")
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            # 检测术语章节开始
            if not started:
                if "国土空间规划术语" in stripped or page_num >= 6:
                    started = True
                else:
                    continue

            # 跳过页码、页眉、TOC 条目（含省略号的行）
            if re.match(r'^[IVX]+$|^\d+$|^TD/T\s|^第\s*\d+\s*页|^\.{3,}', stripped):
                continue
            if re.match(r'^(目\s*次|前\s*言|引\s*言|参考文献|索\s*引)', stripped):
                continue
            if '……' in stripped or re.search(r'\.{4,}', stripped):  # TOC 行特征
                continue

            # 检查是否是新的术语名
            if _is_term_name(stripped, current_def_parts):
                # 保存前一个术语
                if current_term and current_def_parts:
                    real_def = "".join(p for p in current_def_parts if not p.startswith("["))
                    if len(real_def.strip()) >= 8:
                        terms.append({
                            "name": current_term,
                            "definition": "".join(current_def_parts).strip(),
                            "type": "术语",
                            "source": current_source,
                        })

                # 开始新术语，分离中文名和英文翻译
                # 如 "国土空间 territorial space" → name="国土空间"
                name_only = re.split(r'\s{2,}', stripped)[0]  # 取第一个空格前的部分
                name_only = re.sub(r'\s+[a-zA-Z].*$', '', name_only)  # 去掉英文翻译
                current_term = name_only.strip()
                current_def_parts = []
                current_source = ""
                continue

            # 提取来源引用
            source_match = re.match(r'\[(?:来源|来源：|SOURCE)\s*[:：]?\s*(.+?)\]', stripped)
            if source_match:
                current_source = source_match.group(1).strip()
                continue

            # 跳过 [注] 行（PS 内容归入定义但不破坏定义文本流）
            if re.match(r'\[注[：\]]', stripped):
                current_def_parts.append(stripped)
                continue

            # 积累定义文本
            if current_term:
                current_def_parts.append(stripped)

    # 保存最后一个术语
    if current_term and current_def_parts:
        # 过滤掉只有 [注] 没有正文的术语（如"海岸线：见海岸线"这种循环引用）
        real_def = "".join(p for p in current_def_parts if not p.startswith("["))
        if len(real_def.strip()) >= 8:
            terms.append({
                "name": current_term,
                "definition": "".join(current_def_parts).strip(),
                "type": "术语",
                "source": current_source,
            })

    return terms


def _is_term_name(text: str, def_parts: list) -> bool:
    """
    判断一行文本是否是术语名（而非定义文本的一部分）。

    真正术语的特征：
    - 中文术语名 + 英文翻译（空格分隔），如"国土空间 territorial space"
    - 或者：纯中文短词（2-25字），前面已经有完整的定义段落
    """
    # 格式A: "中文术语 english term" — 最可靠的特征
    if re.match(r'^[一-鿿][一-鿿\s]{1,30}\s+[a-zA-Z]', text):
        return True

    # 格式B: 纯中文短行，前面有定义内容，且不是注解
    if 2 <= len(text) <= 25 and re.match(r'^[一-鿿]', text):
        if not text.startswith('[') and not text.startswith('（'):
            if def_parts:
                return True

    return False


if __name__ == "__main__":
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from parse_pdf import parse_pdf

    if len(sys.argv) < 2:
        raise SystemExit("Usage: python scripts/extract_glossary.py <glossary.pdf>")
    pdf_path = sys.argv[1]
    parsed = parse_pdf(pdf_path)
    terms = extract_terms(parsed)
    print(f"提取 {len(terms)} 条术语")
    for t in terms[:20]:
        print(f"  {t['name']}: {t['definition'][:80]}...")
