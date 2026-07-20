"""
文本切片脚本 —— 512 字符窗口 + 128 重叠 + 优先段落边界
"""
import re


def chunk_text(parsed_doc: dict, chunk_size: int = 512, overlap: int = 128) -> list:
    """
    将解析后的文档文本切分为重叠的 chunks。

    Args:
        parsed_doc: parse_pdf 的输出 {"title": ..., "pages": [...]}
        chunk_size: 目标窗口大小（字符数）
        overlap: 重叠量（字符数）

    Returns:
        [{doc_id, page, chunk_index, text, char_start, char_end}, ...]
    """
    doc_id = parsed_doc["title"]
    stride = chunk_size - overlap
    if stride <= 0:
        raise ValueError(f"overlap({overlap}) must be smaller than chunk_size({chunk_size})")

    doc_char_offset = 0  # 全局字符偏移（跨页）
    page_char_map = []   # [(page_num, start_char_offset), ...]
    chunks = []
    chunk_index = 0

    for page_info in parsed_doc["pages"]:
        page_num = page_info["page_num"]
        text = page_info["text"]
        page_len = len(text)

        if page_len == 0:
            continue

        # 过短的页跳过（目录页、空白页等）
        if page_len < 50:
            doc_char_offset += page_len
            continue

        # 短页不切分，整页作为一个 chunk
        if page_len <= chunk_size:
            chunks.append({
                "doc_id": doc_id,
                "page": page_num,
                "chunk_index": chunk_index,
                "text": text.strip(),
                "char_start": doc_char_offset,
                "char_end": doc_char_offset + page_len,
            })
            chunk_index += 1
            doc_char_offset += page_len
            continue

        page_char_map.append((page_num, doc_char_offset))

        # 在当前页内按 stride 切分
        pos = 0
        while pos < page_len:
            # 目标终点
            target_end = pos + chunk_size

            if target_end >= page_len:
                # 本页最后一个 chunk：恰好收尾
                end = page_len
            else:
                # 在 target_end 附近找最佳断点
                search_start = max(pos + int(chunk_size * 0.75), target_end - 100)
                search_end = min(target_end + 100, page_len)
                end = _find_break_point(text, search_start, search_end, target_end)

            chunk_text_str = text[pos:end]
            global_start = doc_char_offset + pos
            global_end = doc_char_offset + end

            chunks.append({
                "doc_id": doc_id,
                "page": page_num,
                "chunk_index": chunk_index,
                "text": chunk_text_str.strip(),
                "char_start": global_start,
                "char_end": global_end,
            })

            chunk_index += 1
            pos = end - overlap if end < page_len else page_len
            if pos >= page_len:
                break

        doc_char_offset += page_len

    return chunks


def _find_break_point(text: str, search_start: int, search_end: int,
                      target: int) -> int:
    """
    在 [search_start, search_end] 范围内寻找最佳断点。
    优先级：段落边界 > 句号 > 换行 > 精确 target
    """
    segment = text[search_start:search_end]

    # 1. 段落边界（空行）
    para_breaks = [m.start() for m in re.finditer(r'\n\s*\n', segment)]
    if para_breaks:
        best = min(para_breaks, key=lambda x: abs(x + search_start - target))
        return best + search_start + 2  # 跳过空行

    # 2. 句号断句
    sent_breaks = [m.end() for m in re.finditer(r'[。！？；\n]', segment)]
    if sent_breaks:
        best = min(sent_breaks, key=lambda x: abs(x + search_start - target))
        return best + search_start

    # 3. 逗号断句
    comma_breaks = [m.end() for m in re.finditer(r'[，、]', segment)]
    if comma_breaks:
        best = min(comma_breaks, key=lambda x: abs(x + search_start - target))
        return best + search_start

    # 4. 精确 target
    return target


if __name__ == "__main__":
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from config import PDF_FILES, CHUNK_SIZE, CHUNK_OVERLAP
    from parse_pdf import parse_pdf

    for pdf_info in PDF_FILES:
        parsed = parse_pdf(pdf_info["path"])
        chunks = chunk_text(parsed, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP)
        sizes = [len(c["text"]) for c in chunks]
        print(f"文档: {parsed['title']}")
        print(f"  chunks: {len(chunks)}, avg size: {sum(sizes)/len(sizes):.0f}, "
              f"min: {min(sizes)}, max: {max(sizes)}")
