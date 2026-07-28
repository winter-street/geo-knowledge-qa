# ============================================================
# 全局配置模板 — 复制为 config.py 并填入你的真实值
# 此文件可安全提交到 Git（不含敏感信息）
# ============================================================

import os

# ---- 路径配置 ----
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data", "samples")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")

if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR, exist_ok=True)

# ---- PDF 源文件 ----
PDF_FILES = [
    {"path": os.path.join(DATA_DIR, "your-doc-1.pdf"), "doc_type": "编制指南"},
    {"path": os.path.join(DATA_DIR, "your-doc-2.pdf"), "doc_type": "用地分类"},
]

# ---- SQLite 数据库 ----
SQLITE_DB_PATH = os.path.join(OUTPUT_DIR, "geo_knowledge.db")

# ---- TF-IDF 模型文件 ----
TFIDF_MODEL_PATH = os.path.join(OUTPUT_DIR, "tfidf_model.pkl")

# ---- 切片参数 ----
CHUNK_SIZE = 512
CHUNK_OVERLAP = 128

# ---- jieba 分词 ----
JIEBA_DICT = None          # 自定义词典路径（可选）
JIEBA_STOP_WORDS = None    # 停用词文件路径（可选）

# ============================================================
# LLM API 配置（DeepSeek / 通义千问 二选一）
# ============================================================
LLM_CONFIG = {
    "provider": "deepseek",                        # 或 "tongyi"
    "api_key": "sk-YOUR-API-KEY-HERE",             # <-- 填你的 key
    "base_url": "https://api.deepseek.com/v1",
    "model": "deepseek-chat",
    "temperature": 0.1,
    "max_tokens": 2048,
}

# ============================================================
# Neo4j 连接配置
# ============================================================
NEO4J_CONFIG = {
    "uri": "bolt://localhost:7687",
    "user": "neo4j",
    "password": "your-neo4j-password-here",        # <-- 填你的密码
}
