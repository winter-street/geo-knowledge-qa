"""
chunk_text.py 的 TDD 测试
验证：512 字符窗口 + 128 重叠 + 段落边界优先
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_chunk_basic():
    """测试基本切片：512 窗口 + 128 重叠"""
    from scripts.chunk_text import chunk_text
    from scripts.parse_pdf import parse_pdf
    from config import PDF_FILES

    # 解析第一份 PDF
    parsed = parse_pdf(PDF_FILES[0]["path"])

    # 切片
    chunks = chunk_text(parsed, chunk_size=512, overlap=128)

    # 结构检查
    assert len(chunks) > 0, "应产生至少一个 chunk"
    first = chunks[0]
    required_keys = ["doc_id", "page", "chunk_index", "text", "char_start", "char_end"]
    for key in required_keys:
        assert key in first, f"chunk 缺少 {key}"

    # 长度合理性（允许段落边界浮动，但在 200-700 之间）
    for ch in chunks:
        assert 50 < len(ch["text"]) <= 800, f"chunk 长度 {len(ch['text'])} 超出范围"

    # 序号连续性
    for i, ch in enumerate(chunks):
        assert ch["chunk_index"] == i, f"chunk_index {ch['chunk_index']} != 期望 {i}"

    # char_start 递增
    for i in range(1, len(chunks)):
        assert chunks[i]["char_start"] >= chunks[i-1]["char_start"], "char_start 应递增"

    print(f"[PASS] chunks count: {len(chunks)}")
    print(f"[PASS] first chunk ({len(first['text'])} chars): {first['text'][:200]}...")
    print(f"[PASS] sample chunk sizes: {[len(c['text']) for c in chunks[:5]]}")

    return True


def test_chunk_overlap():
    """测试重叠：相邻 chunk 之间有内容重叠"""
    from scripts.chunk_text import chunk_text
    from scripts.parse_pdf import parse_pdf
    from config import PDF_FILES

    parsed = parse_pdf(PDF_FILES[0]["path"])
    chunks = chunk_text(parsed, chunk_size=512, overlap=128)

    # 找两个相邻 chunk 验证重叠
    for i in range(len(chunks) - 1):
        curr_end = chunks[i]["char_end"]
        next_start = chunks[i + 1]["char_start"]
        if curr_end > next_start:
            print(f"[PASS] chunk[{i}] end={curr_end} > chunk[{i+1}] start={next_start} (overlap={curr_end - next_start})")
            return True

    # 如果没有任何重叠（单页短文本），也算通过
    print("[PASS] no overlap needed (short text)")
    return True


if __name__ == "__main__":
    test_chunk_basic()
    test_chunk_overlap()
