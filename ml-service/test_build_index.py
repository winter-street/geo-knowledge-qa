"""
build_index.py 的 TDD 测试
验证：SQLite 建表 + TF-IDF 向量化 + 模型序列化
"""
import sys
import os
import tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_build_index():
    """测试建索引全流程"""
    from scripts.build_index import build_index
    from scripts.parse_pdf import parse_pdf
    from scripts.chunk_text import chunk_text
    from config import PDF_FILES, CHUNK_SIZE, CHUNK_OVERLAP

    # 使用临时文件避免污染正式输出
    tmp_dir = tempfile.mkdtemp()
    db_path = os.path.join(tmp_dir, "test.db")
    model_path = os.path.join(tmp_dir, "test_model.pkl")

    try:
        # 解析 + 切片
        parsed = parse_pdf(PDF_FILES[0]["path"])
        chunks = chunk_text(parsed, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP)

        # 建索引
        build_index(parsed, chunks, db_path=db_path, model_path=model_path)

        # 验证 SQLite 文件存在
        assert os.path.exists(db_path), "SQLite 数据库未创建"
        assert os.path.getsize(db_path) > 0, "SQLite 数据库为空"

        # 验证数据表
        import sqlite3
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # documents 表
        cursor.execute("SELECT COUNT(*) FROM documents")
        doc_count = cursor.fetchone()[0]
        assert doc_count == 1, f"documents 应有 1 条记录，实际 {doc_count}"

        cursor.execute("SELECT title, total_pages FROM documents LIMIT 1")
        row = cursor.fetchone()
        assert row[0] == parsed["title"], "文档标题不匹配"
        assert row[1] == parsed["total_pages"], "页数不匹配"

        # chunks 表
        cursor.execute("SELECT COUNT(*) FROM chunks")
        chunk_count = cursor.fetchone()[0]
        assert chunk_count == len(chunks), f"chunks 数量不匹配: DB={chunk_count}, 预期={len(chunks)}"

        # vector BLOB 字段
        cursor.execute("SELECT vector FROM chunks LIMIT 1")
        vec = cursor.fetchone()[0]
        assert vec is not None, "vector 字段为空"
        assert len(vec) > 0, "vector BLOB 长度为 0"

        conn.close()

        # 验证 TF-IDF 模型文件
        assert os.path.exists(model_path), "模型文件未创建"
        assert os.path.getsize(model_path) > 0, "模型文件为空"

        import joblib
        model = joblib.load(model_path)
        assert hasattr(model, "transform"), "模型缺少 transform 方法"
        assert hasattr(model, "vocabulary_"), "模型缺少 vocabulary_"

        print(f"[PASS] docs in DB: {doc_count}")
        print(f"[PASS] chunks in DB: {chunk_count}")
        print(f"[PASS] vector BLOB size: {len(vec)} bytes")
        print(f"[PASS] model vocab size: {len(model.vocabulary_)}")
        print(f"[PASS] model file size: {os.path.getsize(model_path)} bytes")

    finally:
        import shutil
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return True


if __name__ == "__main__":
    test_build_index()
