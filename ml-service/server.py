"""
Phase 1 检索微服务 — 把 SQLite + TF-IDF + Neo4j 暴露为 HTTP 接口
供 B 后端调用。启动: python server.py → localhost:5000
"""
import json
import sqlite3
import os
import sys
import subprocess
import numpy as np
import jieba
import joblib
from flask import Flask, request, jsonify, send_file
from neo4j import GraphDatabase

# ---- 初始化 ----
app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from config import SQLITE_DB_PATH, TFIDF_MODEL_PATH, NEO4J_CONFIG, OUTPUT_DIR, RETRIEVAL_MODE

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

# ---- BERT-NER 模型加载 ----
NER_MODEL_DIR = os.path.join(BASE_DIR, "models", "bert-ner")
_ner_model = None
_ner_tokenizer = None


def load_ner_model():
    global _ner_model, _ner_tokenizer
    if os.path.exists(NER_MODEL_DIR):
        try:
            import torch
            from transformers import BertForTokenClassification, BertTokenizerFast
            os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
            _ner_tokenizer = BertTokenizerFast.from_pretrained(NER_MODEL_DIR)
            _ner_model = BertForTokenClassification.from_pretrained(NER_MODEL_DIR)
            _ner_model.eval()
            print(f"BERT-NER 模型已加载: {NER_MODEL_DIR}")
        except Exception as e:
            print(f"BERT-NER 加载失败: {e}")
    else:
        print(f"BERT-NER 模型目录不存在: {NER_MODEL_DIR}")


# ---- BGE 向量检索 ----
BGE_QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章："
_bge_model = None
_chunk_vectors = None  # numpy 矩阵 (121, dim)
_chunk_meta = []       # [(text, doc_title, page, chunk_id), ...]


def load_bge_index():
    global _bge_model, _chunk_vectors, _chunk_meta
    from sentence_transformers import SentenceTransformer

    if _bge_model is None:
        _bge_model = SentenceTransformer("BAAI/bge-small-zh-v1.5")
    dim = _bge_model.get_embedding_dimension()

    conn = sqlite3.connect(SQLITE_DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT c.text, d.title, c.page, c.id
        FROM chunks c JOIN documents d ON c.doc_id = d.id
        ORDER BY c.id
    """)
    rows = cursor.fetchall()

    # 从 SQLite 读取预存向量
    cursor.execute("SELECT vector FROM chunks ORDER BY id")
    vec_rows = cursor.fetchall()
    conn.close()

    vectors = []
    for (vec_blob,) in vec_rows:
        if vec_blob:
            vec = np.frombuffer(vec_blob, dtype=np.float32)
            vectors.append(vec)

    if vectors:
        _chunk_vectors = np.vstack(vectors)
        # 归一化（确保点积=余弦）
        norms = np.linalg.norm(_chunk_vectors, axis=1, keepdims=True)
        _chunk_vectors = _chunk_vectors / norms
    else:
        _chunk_vectors = np.array([])

    _chunk_meta = [(text, title, page, row_id) for text, title, page, row_id in rows]
    print(f"BGE 索引已加载: {len(_chunk_meta)} chunks, dim={dim}")


# 加载 TF-IDF 模型（启动时一次性）
_model = None


def get_model():
    global _model
    if _model is None:
        _model = joblib.load(TFIDF_MODEL_PATH)
    return _model


def _is_bge_available():
    if _bge_model is None:
        return False, "BGE 模型尚未加载"
    if _chunk_vectors is None or len(_chunk_vectors) == 0:
        return False, "BGE 向量索引为空或尚未加载"
    if not _chunk_meta:
        return False, "BGE 切片元数据为空"
    return True, None


def _is_tfidf_available():
    if not os.path.exists(TFIDF_MODEL_PATH):
        return False, "TF-IDF 模型文件不存在"
    try:
        get_model()
        return True, None
    except Exception as exc:
        return False, f"TF-IDF 模型加载失败: {exc}"


# Neo4j driver（延迟连接）
_neo4j_driver = None


def get_neo4j():
    global _neo4j_driver
    if _neo4j_driver is None:
        cfg = NEO4J_CONFIG
        _neo4j_driver = GraphDatabase.driver(
            cfg["uri"], auth=(cfg["user"], cfg["password"])
        )
    return _neo4j_driver


# ---- 工具函数 ----

def _tokenize(text: str) -> str:
    """jieba 分词，返回空格分隔"""
    words = jieba.cut(text)
    return " ".join(w for w in words if len(w.strip()) > 1)


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """余弦相似度"""
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))


# ---- 接口 ----

@app.route("/search", methods=["POST"])
def search():
    """
    向量检索（支持 bge 和 tfidf 两种模式）。
    Request:  { "question": "...", "top_k": 5 }
    Response: { "chunks": [{doc_title, page, text, score}, ...] }
    """
    data = request.get_json(force=True)
    question = data.get("question", "").strip()
    top_k = data.get("top_k", 5)
    retrieval_mode = data.get("retrieval_mode", RETRIEVAL_MODE)

    if not question:
        return jsonify({"error": "question is empty"}), 400
    if retrieval_mode not in ("bge", "tfidf"):
        return jsonify({
            "error": "retrieval_mode must be bge or tfidf",
            "code": "INVALID_RETRIEVAL_MODE",
        }), 400
    if not isinstance(top_k, int) or isinstance(top_k, bool) or not 1 <= top_k <= 20:
        return jsonify({"error": "top_k must be an integer between 1 and 20"}), 400

    availability = _is_bge_available if retrieval_mode == "bge" else _is_tfidf_available
    available, reason = availability()
    if not available:
        return jsonify({
            "error": f"{retrieval_mode} retrieval is unavailable",
            "code": "RETRIEVAL_MODE_UNAVAILABLE",
            "mode": retrieval_mode,
            "reason": reason,
        }), 503

    if retrieval_mode == "bge":
        return _search_bge(question, top_k)
    return _search_tfidf(question, top_k)


@app.route("/reload-index", methods=["POST"])
def reload_index():
    """Reload retrieval metadata after the admin service changes SQLite."""
    global _model
    try:
        if RETRIEVAL_MODE == "bge":
            load_bge_index()
            chunk_count = len(_chunk_meta)
        else:
            _model = joblib.load(TFIDF_MODEL_PATH)
            with sqlite3.connect(SQLITE_DB_PATH) as conn:
                chunk_count = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
        return jsonify({"success": True, "mode": RETRIEVAL_MODE, "chunk_count": chunk_count})
    except Exception as exc:
        app.logger.exception("Failed to reload retrieval index")
        return jsonify({"error": str(exc)}), 500


def _search_bge(question, top_k):
    """BGE 语义检索"""
    # bge 检索模式：查询侧加前缀
    query_with_prefix = BGE_QUERY_PREFIX + question
    q_vec = _bge_model.encode([query_with_prefix], normalize_embeddings=True)[0]

    # 批量点积（已归一化，点积=余弦）
    scores = _chunk_vectors @ q_vec

    # Top-K
    top_indices = np.argsort(scores)[::-1][:top_k]

    results = []
    for idx in top_indices:
        text, title, page, cid = _chunk_meta[idx]
        results.append({
            "id": cid,
            "doc_title": title,
            "page": page,
            "text": text,
            "score": round(float(scores[idx]), 4),
        })

    # 闲聊阈值：bge 相似度普遍 0.3-0.7
    CHATTER_THRESHOLD = 0.4
    is_chatter = len(results) == 0 or results[0]["score"] < CHATTER_THRESHOLD

    return jsonify({"chunks": results, "is_chatter": is_chatter, "mode": "bge"})


def _search_tfidf(question, top_k):
    """TF-IDF 关键词检索（原有逻辑）"""
    tokens = _tokenize(question)
    model = get_model()
    query_vec = model.transform([tokens]).toarray()[0]

    conn = sqlite3.connect(SQLITE_DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        """SELECT c.id, c.page, c.text, c.tokens, d.title AS doc_title
           FROM chunks c JOIN documents d ON c.doc_id = d.id"""
    )

    scored = []
    for row in cursor.fetchall():
        tokens_text = row["tokens"]
        if not tokens_text:
            continue
        chunk_vec = model.transform([tokens_text]).toarray()[0]
        score = _cosine_similarity(query_vec, chunk_vec)
        scored.append({
            "id": row["id"],
            "doc_title": row["doc_title"],
            "page": row["page"],
            "text": row["text"],
            "score": round(score, 4),
        })

    conn.close()

    scored.sort(key=lambda x: x["score"], reverse=True)
    top = scored[:top_k]

    return jsonify({"chunks": top, "mode": "tfidf"})


@app.route("/kg/search", methods=["POST"])
def kg_search():
    """
    Neo4j 子图查询。
    Request:  { "keyword": "养老", "limit": 10 }
    Response: { "nodes": [{id, label, type}], "edges": [{source, target, label, display}] }
    """
    data = request.get_json(force=True)
    keyword = data.get("keyword", "").strip()
    limit = data.get("limit", 10)

    if not keyword:
        return jsonify({"error": "keyword is empty"}), 400

    # 分词取关键词
    words = [w for w in jieba.cut(keyword) if len(w.strip()) >= 2][:3]
    if not words:
        words = [keyword]

    driver = get_neo4j()
    nodes = {}
    edges = []

    with driver.session() as session:
        for kw in words:
            result = session.run(
                """MATCH (n)-[r]->(m)
                   WHERE n.name CONTAINS $kw OR m.name CONTAINS $kw
                   RETURN n, r, m
                   LIMIT $limit""",
                kw=kw, limit=limit,
            )
            for record in result:
                n = record["n"]
                m = record["m"]
                rel = record["r"]

                # 收集节点
                for node in (n, m):
                    node_id = str(node.id)
                    if node_id not in nodes:
                        label = list(node.labels)[0] if node.labels else "Unknown"
                        nodes[node_id] = {
                            "id": node_id,
                            "label": node.get("name", node.get("title", str(node.id))),
                            "type": label,
                        }

                # 收集边
                edges.append({
                    "source": str(n.id),
                    "target": str(m.id),
                    "label": type(rel).__name__,
                    "display": rel.get("display", type(rel).__name__),
                })

    return jsonify({
        "nodes": list(nodes.values()),
        "edges": edges,
    })


@app.route("/ner", methods=["POST"])
def ner_extract():
    """BERT-NER 实体提取"""
    if _ner_model is None:
        return jsonify({"error": "NER model not loaded", "entities": []}), 503

    import torch

    data = request.get_json(force=True)
    text = data.get("text", "")
    if not text:
        return jsonify({"error": "missing 'text' field", "entities": []}), 400

    ID2LABEL = _ner_model.config.id2label

    chars = list(text)
    encoding = _ner_tokenizer(
        chars,
        is_split_into_words=True,
        padding=True,
        truncation=True,
        return_tensors="pt"
    )

    with torch.no_grad():
        outputs = _ner_model(**encoding)
        preds = outputs.logits.argmax(-1)[0].tolist()

    # 解析实体
    entities = []
    current_entity = None
    for i, (char, pred_id) in enumerate(zip(chars, preds)):
        if i >= len(preds):
            break
        label = ID2LABEL.get(pred_id, "O")

        if label.startswith("B-"):
            if current_entity:
                entities.append(current_entity)
            entity_type = label[2:]
            current_entity = {
                "entity": char,
                "type": entity_type,
                "start": i,
                "end": i + 1
            }
        elif label.startswith("I-") and current_entity:
            entity_type = label[2:]
            if entity_type == current_entity["type"]:
                current_entity["entity"] += char
                current_entity["end"] = i + 1
            else:
                entities.append(current_entity)
                current_entity = None
        else:
            if current_entity:
                entities.append(current_entity)
                current_entity = None

    if current_entity:
        entities.append(current_entity)

    return jsonify({"entities": entities})


@app.route("/health", methods=["GET"])
def health():
    bge_available, bge_reason = _is_bge_available()
    tfidf_available, tfidf_reason = _is_tfidf_available()
    available_modes = []
    if bge_available:
        available_modes.append("bge")
    if tfidf_available:
        available_modes.append("tfidf")
    return jsonify({
        "status": "ok",
        "retrieval": {
            "default_mode": RETRIEVAL_MODE,
            "available_modes": available_modes,
            "bge": {"available": bge_available, "reason": bge_reason},
            "tfidf": {"available": tfidf_available, "reason": tfidf_reason},
        },
        "ner": {
            "available": _ner_model is not None,
            "reason": None if _ner_model is not None else "BERT-NER 模型未加载",
        },
    })


@app.route("/stats", methods=["GET"])
def stats():
    """返回 Neo4j 和 SQLite 统计（供开发面板使用）"""
    stats = {"neo4j": {}, "sqlite": {}}
    try:
        driver = get_neo4j()
        with driver.session() as s:
            for label in ["Document", "Mineral", "Rock", "Structure", "TimePeriod", "DepositType"]:
                r = s.run(f"MATCH (n:{label}) RETURN count(n) AS c").single()
                if r["c"] > 0:
                    stats["neo4j"][label] = r["c"]
            r = s.run("MATCH (n) RETURN count(n) AS c").single()
            stats["neo4j"]["totalNodes"] = r["c"]
            r = s.run("MATCH ()-[r]->() RETURN count(r) AS c").single()
            stats["neo4j"]["totalRels"] = r["c"]
            for rel_type in ["HOSTED_IN", "CONTROLLED_BY", "FORMED_IN", "BELONGS_TO",
                            "ASSOCIATED_WITH", "CUTS", "REFERENCES"]:
                r = s.run(f"MATCH ()-[r:{rel_type}]->() RETURN count(r) AS c").single()
                if r["c"] > 0:
                    stats["neo4j"][rel_type] = r["c"]
    except Exception as e:
        stats["neo4j"]["error"] = str(e)

    try:
        conn = sqlite3.connect(SQLITE_DB_PATH)
        c = conn.cursor()
        c.execute("SELECT count(*) FROM documents")
        stats["sqlite"]["documents"] = c.fetchone()[0]
        c.execute("SELECT count(*) FROM chunks")
        stats["sqlite"]["chunks"] = c.fetchone()[0]
        conn.close()
    except Exception as e:
        stats["sqlite"]["error"] = str(e)

    return jsonify(stats)


# ---- 进程管理 ----
_processes: dict[str, subprocess.Popen] = {}

SERVICE_CONFIG: dict[str, dict] = {
    "neo4j": {
        "cmd": ["powershell", "-ExecutionPolicy", "Bypass",
                "-File", r"D:\neo4j-community-5.26.4-windows\neo4j-community-5.26.4\bin\neo4j.ps1",
                "console"],
        "cwd": None,
        "check_url": "http://localhost:7474",
    },
    "backend": {
        "cmd": ["cmd", "/c", "npx tsx src/index.ts"],
        "cwd": os.path.join(BASE_DIR, "..", "backend"),
        "check_url": "http://127.0.0.1:3000/api/health",
    },
    "frontend": {
        "cmd": ["cmd", "/c", "npm run dev"],
        "cwd": os.path.join(BASE_DIR, "..", "frontend"),
        "check_url": "http://localhost:5173",
    },
}


@app.route("/start/<name>", methods=["POST"])
def start_service(name: str):
    if name not in SERVICE_CONFIG:
        return jsonify({"error": f"未知服务: {name}"}), 404
    if name in _processes and _processes[name].poll() is None:
        return jsonify({"status": "already_running"})

    cfg = SERVICE_CONFIG[name]
    try:
        p = subprocess.Popen(
            cfg["cmd"],
            cwd=cfg["cwd"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            shell=False,
        )
        _processes[name] = p
        return jsonify({"status": "started", "pid": p.pid})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/stop/<name>", methods=["POST"])
def stop_service(name: str):
    if name not in SERVICE_CONFIG:
        return jsonify({"error": f"未知服务: {name}"}), 404
    killed = False
    # 1. 先杀 Flask 管理的进程
    if name in _processes:
        p = _processes[name]
        if p.poll() is None:
            p.terminate()
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
        del _processes[name]
        killed = True
    # 2. 兜底：按端口杀（处理 start_all.py 等外部启动的进程）
    port_map = {"neo4j": 7474, "backend": 3000, "frontend": 5173}
    if name in port_map:
        port = port_map[name]
        try:
            # Windows: netstat -ano | findstr :PORT → 取 PID → taskkill
            result = subprocess.run(
                f'netstat -ano | findstr ":{port}" | findstr "LISTENING"',
                capture_output=True, text=True, shell=True, timeout=5,
            )
            for line in result.stdout.strip().split("\n"):
                parts = line.strip().split()
                if parts:
                    pid = parts[-1]
                    if pid.isdigit():
                        subprocess.run(
                            f"taskkill -pid {pid} -f",
                            capture_output=True, shell=True, timeout=10,
                        )
                        killed = True
        except Exception:
            pass
    if killed:
        return jsonify({"status": "stopped"})
    return jsonify({"status": "not_found", "hint": "进程未找到，可能已停止"})


@app.route("/processes", methods=["GET"])
def list_processes():
    return jsonify({
        name: {"running": p.poll() is None, "pid": p.pid}
        for name, p in _processes.items()
    })


@app.route("/dashboard", methods=["GET"])
def dashboard():
    """开发面板"""
    return send_file(os.path.join(BASE_DIR, "dashboard.html"))


# ---- OWL 本体推理 ----

_ontology = None


def get_ontology():
    """延迟加载 OWL 本体"""
    global _ontology
    if _ontology is None:
        from owlready2 import get_ontology as _load_onto
        owl_path = os.path.join(OUTPUT_DIR, "geo_planning.owl")
        if os.path.exists(owl_path):
            _ontology = _load_onto(owl_path).load()
        else:
            _ontology = None
    return _ontology


@app.route("/ontology/status", methods=["GET"])
def ontology_status():
    """返回本体状态（类数量、实例数量、对象属性数量）"""
    onto = get_ontology()
    if onto is None:
        return jsonify({"error": "本体文件不存在，请先运行 build_ontology.py"}), 404

    classes = list(onto.classes())
    individuals = list(onto.individuals())
    obj_props = list(onto.object_properties())

    return jsonify({
        "status": "ok",
        "owl_path": os.path.join(OUTPUT_DIR, "geo_planning.owl"),
        "classes": len(classes),
        "individuals": len(individuals),
        "object_properties": len(obj_props),
        "class_names": [c.name for c in classes],
    })


@app.route("/ontology/reason", methods=["POST"])
def run_reason_endpoint():
    """运行 HermiT 推理，返回推理结果"""
    onto = get_ontology()
    if onto is None:
        return jsonify({"error": "本体文件不存在，请先运行 build_ontology.py"}), 404

    from owlready2 import sync_reasoner

    try:
        with onto:
            sync_reasoner()
    except Exception as e:
        return jsonify({"error": f"推理失败: {str(e)}"}), 500

    # 提取所有关系
    relations = []
    for prop in onto.object_properties():
        for s, o in prop.get_relations():
            relations.append({
                "from": s.name,
                "relation": prop.name,
                "to": o.name,
            })

    return jsonify({
        "status": "ok",
        "total_relations": len(relations),
        "relations": relations,
    })


@app.route("/ontology/query", methods=["POST"])
def ontology_query():
    """按实体名查询本体中的关系"""
    data = request.get_json(force=True)
    entity_name = data.get("entity", "").strip()
    if not entity_name:
        return jsonify({"error": "entity is empty"}), 400

    onto = get_ontology()
    if onto is None:
        return jsonify({"error": "本体文件不存在"}), 404

    # 查找实体
    target = None
    for ind in onto.individuals():
        if ind.name == entity_name:
            target = ind
            break

    if target is None:
        return jsonify({"error": f"实体 '{entity_name}' 不存在"}), 404

    # 收集该实体的所有关系
    relations = []
    for prop in onto.object_properties():
        for s, o in prop.get_relations():
            if s == target or o == target:
                relations.append({
                    "from": s.name,
                    "relation": prop.name,
                    "to": o.name,
                })

    # 获取类信息
    classes = [c.name for c in target.is_a]

    return jsonify({
        "entity": entity_name,
        "classes": classes,
        "relations": relations,
    })


# ---- 启动 ----

if __name__ == "__main__":
    print("Loading TF-IDF model...")
    get_model()
    print(f"Model loaded: {len(get_model().vocabulary_)} vocab")
    load_ner_model()
    if RETRIEVAL_MODE == "bge":
        load_bge_index()
    print("Starting Flask on :5000")
    app.run(host="127.0.0.1", port=5000, debug=False)
