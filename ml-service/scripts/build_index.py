"""
TF-IDF 向量化 + SQLite 存储脚本（统一版本）
所有文档一起训练一个 TF-IDF 模型，保证维度一致
"""
import sqlite3
import joblib
import numpy as np
import jieba
from sklearn.feature_extraction.text import TfidfVectorizer


def build_index(doc_chunks_pairs: list, db_path: str, model_path: str,
                incremental: bool = False) -> dict:
    """
    对所有文档的 chunks 统一训练 TF-IDF，存入 SQLite。

    Args:
        doc_chunks_pairs: [(parsed_doc, chunks_list), ...]
        db_path: SQLite 数据库路径
        model_path: TF-IDF 模型保存路径
        incremental: True 时追加新文档，不删除已有数据（上传后使用）

    Returns:
        {"doc_count": int, "chunk_count": int, "vocab_size": int}
    """
    import os

    # ---- 增量模式：加载已有 chunks 一起重算 TF-IDF ----
    existing_chunks = []
    existing_docs = set()
    if incremental and os.path.exists(db_path):
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT text FROM chunks ORDER BY id").fetchall()
        existing_chunks = [r["text"] for r in rows]
        # 记录已有文档标题，跳过重复上传
        docs = conn.execute("SELECT title FROM documents").fetchall()
        existing_docs = {r["title"] for r in docs}
        conn.close()

    # ---- 第一步：收集所有 chunks 并分词 ----
    all_chunks = []
    doc_titles = []
    for parsed_doc, chunks in doc_chunks_pairs:
        title = parsed_doc["title"]
        if incremental and title in existing_docs:
            print(f"  [增量] 跳过重复文档: {title}")
            continue
        for c in chunks:
            c["_doc_title"] = title
            c["_doc_type"] = parsed_doc.get("doc_type", "")
            c["_total_pages"] = parsed_doc["total_pages"]
        all_chunks.extend(chunks)
        doc_titles.append(title)

    if not all_chunks:
        print("  [增量] 无新文档，跳过")
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM documents")
        dc = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM chunks")
        cc = cursor.fetchone()[0]
        conn.close()
        return {"doc_count": dc, "chunk_count": cc, "vocab_size": 0}

    new_texts = [_tokenize(ch["text"]) for ch in all_chunks]
    # 合并已有 chunks 的文本（只用于 TF-IDF 重训练，不重复入库）
    all_texts = [_tokenize(t) for t in existing_chunks] + new_texts
    new_only = [_tokenize(ch["text"]) for ch in all_chunks]

    # ---- 第二步：全量重训 TF-IDF（保证词汇覆盖） ----
    vectorizer = TfidfVectorizer(
        tokenizer=_identity_split,
        token_pattern=None,
        lowercase=False,
    )
    tfidf_matrix = vectorizer.fit_transform(all_texts)
    # 新 chunk 的向量从全量矩阵尾部切片
    new_vecs = tfidf_matrix[-len(all_chunks):] if len(all_chunks) > 0 else tfidf_matrix

    # ---- 第三步：建/开 SQLite ----
    if incremental and os.path.exists(db_path):
        conn = sqlite3.connect(db_path)
    else:
        if os.path.exists(db_path):
            os.remove(db_path)
        conn = sqlite3.connect(db_path)

    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            doc_type TEXT,
            total_pages INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_id INTEGER REFERENCES documents(id),
            page INTEGER,
            chunk_index INTEGER,
            text TEXT NOT NULL,
            tokens TEXT,
            vector BLOB,
            char_start INTEGER,
            char_end INTEGER
        )
    """)

    # ---- 第四步：写入（仅新文档） ----
    for i, (parsed_doc, chunks) in enumerate(doc_chunks_pairs):
        title = parsed_doc["title"]
        if incremental and title in existing_docs:
            continue
        doc_type = parsed_doc.get("doc_type", "")
        total_pages = parsed_doc["total_pages"]

        cursor.execute(
            "INSERT INTO documents (title, doc_type, total_pages) VALUES (?, ?, ?)",
            (title, doc_type, total_pages)
        )
        doc_id = cursor.lastrowid

        for j, ch in enumerate(chunks):
            vec_idx = sum(len(cs) for _, cs in doc_chunks_pairs[:i]) + j
            vec = new_vecs[vec_idx].toarray()[0].astype(np.float32).tobytes()
            cursor.execute(
                """INSERT INTO chunks
                   (doc_id, page, chunk_index, text, tokens, vector, char_start, char_end)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (doc_id, ch["page"], ch["chunk_index"],
                 ch["text"], new_texts[vec_idx], vec,
                 ch["char_start"], ch["char_end"])
            )

    conn.commit()

    cursor.execute("SELECT COUNT(*) FROM documents")
    doc_count = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM chunks")
    chunk_count = cursor.fetchone()[0]

    conn.close()

    # ---- 保存模型 ----
    joblib.dump(vectorizer, model_path)

    return {
        "doc_count": doc_count,
        "chunk_count": chunk_count,
        "vocab_size": len(vectorizer.vocabulary_),
    }


def _identity_split(text: str) -> list:
    return text.split()


def _tokenize(text: str) -> str:
    words = jieba.cut(text)
    return " ".join(w.strip() for w in words if len(w.strip()) > 1)


if __name__ == "__main__":
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from config import PDF_FILES, CHUNK_SIZE, CHUNK_OVERLAP, SQLITE_DB_PATH, TFIDF_MODEL_PATH
    from parse_pdf import parse_pdf
    from chunk_text import chunk_text

    doc_chunks_pairs = []
    for pdf_info in PDF_FILES:
        parsed = parse_pdf(pdf_info["path"])
        parsed["doc_type"] = pdf_info["doc_type"]
        chunks = chunk_text(parsed, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP)
        doc_chunks_pairs.append((parsed, chunks))
        print(f"Parsed: {parsed['title']} ({len(chunks)} chunks)")

    stats = build_index(doc_chunks_pairs, db_path=SQLITE_DB_PATH, model_path=TFIDF_MODEL_PATH)
    print(f"Done: {stats}")
