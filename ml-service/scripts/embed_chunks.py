"""bge-small-zh-v1.5 编码 chunks 写回 SQLite"""
import os
import sys
import sqlite3
import numpy as np

os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")


def embed_chunks(db_path: str = None, incremental: bool = False):
    """
    用 bge-small-zh-v1.5 编码 SQLite chunks，写回 vector 列。

    Args:
        db_path: SQLite 数据库路径
        incremental: True 时只编码 vector 列为 NULL 的新 chunk（上传后增量）
    """
    from sentence_transformers import SentenceTransformer

    if db_path is None:
        db_path = os.path.join(os.path.dirname(__file__), "..", "output", "geo_knowledge.db")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    if incremental:
        # 增量模式：找维度不匹配的 chunk（build_index 写入了 TF-IDF，需覆盖为 BGE）
        # BGE 512 维 = 512*4 = 2048 bytes；TF-IDF 维度不定但不会是 2048
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'")
        has_meta = cursor.fetchone() is not None
        if has_meta:
            cursor.execute("SELECT value FROM meta WHERE key='vector_dim'")
            row = cursor.fetchone()
            expected_dim = int(row[0]) if row else 512
        else:
            expected_dim = 512
        expected_bytes = expected_dim * 4  # float32 = 4 bytes

        # 找所有 vector 字节数不等于 BGE 维度的 chunk
        cursor.execute("SELECT id, text FROM chunks WHERE length(vector) != ? ORDER BY id", (expected_bytes,))
    else:
        cursor.execute("SELECT id, text FROM chunks ORDER BY id")

    rows = cursor.fetchall()

    if not rows:
        print(f"[embed_chunks] {'增量' if incremental else '全量'}: 无待编码 chunk")
        conn.close()
        return {"encoded": 0, "dim": 512}

    ids, texts = zip(*rows)

    # Prefer the local cache during bulk imports to avoid a metadata request per run.
    try:
        model = SentenceTransformer("BAAI/bge-small-zh-v1.5", local_files_only=True)
    except OSError:
        model = SentenceTransformer("BAAI/bge-small-zh-v1.5")
    dim = model.get_embedding_dimension()

    print(f"[embed_chunks] {'增量' if incremental else '全量'}: {len(rows)} chunks, dim={dim}")
    embeddings = model.encode(list(texts), normalize_embeddings=True)

    for i, (chunk_id, vec) in enumerate(zip(ids, embeddings)):
        vec_blob = vec.astype(np.float32).tobytes()
        if incremental:
            cursor.execute("UPDATE chunks SET vector = ? WHERE id = ?", (vec_blob, chunk_id))
        else:
            cursor.execute("UPDATE chunks SET vector = ? WHERE id = ?", (vec_blob, chunk_id))

    # 记录向量类型
    cursor.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
    cursor.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
                   ("vector_type", "bge-small-zh-v1.5"))
    cursor.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
                   ("vector_dim", str(dim)))

    conn.commit()
    conn.close()

    print(f"[embed_chunks] {len(rows)} 个 BGE 向量已写入 SQLite")
    return {"encoded": len(rows), "dim": dim}


def main():
    embed_chunks()


if __name__ == "__main__":
    main()
