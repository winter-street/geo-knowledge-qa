"""
一键执行全流程：PDF → 切片 → TF-IDF → SQLite + Neo4j
支持 --from-step4 跳过 Steps 1-3（SQLite 已就绪时）
"""
import sys
import os
import time
import sqlite3

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from config import (PDF_FILES, SQLITE_DB_PATH, TFIDF_MODEL_PATH,
                    CHUNK_SIZE, CHUNK_OVERLAP, LLM_CONFIG, NEO4J_CONFIG)

SKIP_STEPS_1_3 = "--from-step4" in sys.argv
IS_SINGLE_FILE = False  # --file 单文件上传模式，增量追加而非全量重建


def write_reasoning_results(write_fn, reason_stats):
    """Write inferred relations and OWL classifications together."""
    write_fn(reason_stats["relations"], reason_stats["classifications"])


def step(name: str):
    """打印步骤标题"""
    print(f"\n{'='*60}")
    print(f"  {name}")
    print(f"{'='*60}")


def run():
    start_time = time.time()
    parsed_docs = []
    all_chunks = []

    # 检查是否可以跳过 Steps 1-3
    db_exists = os.path.exists(SQLITE_DB_PATH)
    if SKIP_STEPS_1_3 and db_exists:
        print("\n[--from-step4] 跳过 Steps 1-3，从 SQLite 重建 parsed_docs...")
        conn = sqlite3.connect(SQLITE_DB_PATH)
        conn.row_factory = sqlite3.Row
        docs = conn.execute("SELECT id, title, total_pages FROM documents ORDER BY id").fetchall()
        chunks = conn.execute("SELECT doc_id, page, chunk_index, text FROM chunks ORDER BY id").fetchall()
        conn.close()
        # 重建 parsed_docs：从 chunks 重组页面文本
        from collections import defaultdict
        doc_pages = defaultdict(lambda: defaultdict(list))
        for c in chunks:
            doc_pages[c["doc_id"]][c["page"]].append((c["chunk_index"], c["text"]))
        for d in docs:
            dt = ""
            for pf in PDF_FILES:
                if d["title"] in pf["path"] or os.path.basename(pf["path"]).startswith(d["title"][:10]):
                    dt = pf["doc_type"]
                    break
            pages = []
            page_chunks = doc_pages.get(d["id"], {})
            for pn in sorted(page_chunks.keys()):
                # 按 chunk_index 排序拼接
                sorted_chunks = sorted(page_chunks[pn], key=lambda x: x[0])
                page_text = "\n".join(t for _, t in sorted_chunks)
                pages.append({"page_num": pn, "text": page_text})
            parsed_docs.append({"title": d["title"], "total_pages": d["total_pages"] or 0, "pages": pages, "doc_type": dt})
        for c in chunks:
            all_chunks.append({"doc_id": c["doc_id"], "page": c["page"], "chunk_index": c["chunk_index"], "text": c["text"]})
        print(f"  DB: {len(docs)} 文档, {len(chunks)} chunks")
    else:
        # ---- Step 1: PDF 解析 ----
        step("Step 1/5: PDF 解析")
        from parse_pdf import parse_pdf

        for pdf_info in PDF_FILES:
            t0 = time.time()
            result = parse_pdf(pdf_info["path"])
            result["doc_type"] = pdf_info["doc_type"]
            elapsed = time.time() - t0
            chars = sum(len(p["text"]) for p in result["pages"])
            print(f"  {result['title']}")
            print(f"    页数: {result['total_pages']}, 字符: {chars}, 耗时: {elapsed:.1f}s")
            parsed_docs.append(result)

        # ---- Step 2: 文本切片 ----
        step("Step 2/5: 文本切片")
        from chunk_text import chunk_text

        for parsed in parsed_docs:
            t0 = time.time()
            chunks = chunk_text(parsed, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP)
            elapsed = time.time() - t0
            sizes = [len(c["text"]) for c in chunks]
            print(f"  {parsed['title']}: {len(chunks)} chunks, "
                  f"avg={sum(sizes)//max(len(sizes),1)}, "
                  f"range=[{min(sizes, default=0)}, {max(sizes, default=0)}], "
                  f"耗时: {elapsed:.1f}s")
            all_chunks.extend(chunks)

        # ---- Step 3: TF-IDF 向量化 + 存 SQLite ----
        step("Step 3/5: TF-IDF 向量化 + SQLite（统一模型）")
        from build_index import build_index

        t0 = time.time()
        doc_chunks_pairs = []
        for parsed in parsed_docs:
            doc_chunks = [c for c in all_chunks if c["doc_id"] == parsed["title"]]
            doc_chunks_pairs.append((parsed, doc_chunks))
        stats = build_index(doc_chunks_pairs, db_path=SQLITE_DB_PATH, model_path=TFIDF_MODEL_PATH,
                          incremental=IS_SINGLE_FILE)
        print(f"  {'[增量] ' if IS_SINGLE_FILE else ''}统一模型: docs={stats['doc_count']}, "
              f"chunks={stats['chunk_count']}, vocab={stats['vocab_size']}")
        print(f"  DB: {SQLITE_DB_PATH}")
        print(f"  Model: {TFIDF_MODEL_PATH}")
        print(f"  耗时: {time.time() - t0:.1f}s")

        # BGE 编码（覆盖 TF-IDF 向量，写入 512 维语义向量）
        # --from-step4 时不跑（chunks 未变，向量已是最新）
        if not SKIP_STEPS_1_3:
            from embed_chunks import embed_chunks
            t0 = time.time()
            emb_stats = embed_chunks(db_path=SQLITE_DB_PATH, incremental=IS_SINGLE_FILE)
            if emb_stats["encoded"] > 0:
                print(f"  BGE 编码: {emb_stats['encoded']} chunks, dim={emb_stats['dim']}, 耗时: {time.time() - t0:.1f}s")

    # ---- Step 4: 实体提取 ----
    step("Step 4/5: 实体提取")

    from extract_landuse import extract_landuse
    from extract_concepts import extract_concepts
    from extract_hybrid import extract_hybrid

    landuse_nodes = []
    concepts = {"concepts": [], "relations": []}
    document_entities = {}

    for parsed in parsed_docs:
        if parsed.get("doc_type") == "用地分类":
            t0 = time.time()
            landuse_nodes = extract_landuse(parsed)
            levels = {"大类": 0, "中类": 0, "小类": 0}
            for n in landuse_nodes:
                levels[n["level"]] += 1
            print(f"  用地分类: {len(landuse_nodes)} 节点 "
                  f"(大类={levels['大类']}, 中类={levels['中类']}, 小类={levels['小类']}), "
                  f"耗时: {time.time() - t0:.1f}s")

        elif parsed.get("doc_type") == "编制指南":
            t0 = time.time()
            doc_concepts = extract_concepts(parsed, LLM_CONFIG, dry_run=False)
            concepts["concepts"].extend(doc_concepts.get("concepts", []))
            concepts["relations"].extend(doc_concepts.get("relations", []))
            document_entities[parsed["title"]] = [
                {"name": name, "type": entity_type}
                for name, entity_type in sorted({
                    (c["name"], c.get("type", "Concept"))
                    for c in doc_concepts.get("concepts", []) if c.get("name")
                })
            ]
            print(f"  规划概念: {len(doc_concepts['concepts'])} 概念, "
                  f"{len(doc_concepts['relations'])} 关系, "
                  f"耗时: {time.time() - t0:.1f}s")
            if doc_concepts["concepts"]:
                print(f"    示例概念: {[c['name'] for c in doc_concepts['concepts'][:5]]}")

        elif parsed.get("doc_type") == "地质":
            t0 = time.time()
            geo_concepts = extract_hybrid(parsed, LLM_CONFIG, dry_run=False)
            # 合并到总的 concepts 里
            concepts["concepts"].extend(geo_concepts.get("concepts", []))
            concepts["relations"].extend(geo_concepts.get("relations", []))
            document_entities[parsed["title"]] = [
                {"name": name, "type": entity_type}
                for name, entity_type in sorted({
                    (c["name"], c.get("type", "Concept"))
                    for c in geo_concepts.get("concepts", []) if c.get("name")
                })
            ]
            print(f"  地质实体(混合): {len(geo_concepts.get('concepts', []))} 实体, "
                  f"{len(geo_concepts.get('relations', []))} 关系, "
                  f"耗时: {time.time() - t0:.1f}s")
            if geo_concepts.get("concepts"):
                print(f"    示例实体: {[c['name'] for c in geo_concepts['concepts'][:5]]}")

    # ---- Step 5: 写入 Neo4j ----
    step("Step 5/5: 写入 Neo4j")

    from write_neo4j import connect_neo4j, clear_all_data, write_all

    t0 = time.time()
    driver = connect_neo4j(NEO4J_CONFIG)
    if IS_SINGLE_FILE:
        print("  [增量] 跳过清空，追加写入...")
    else:
        clear_all_data(driver)
    stats = write_all(driver, parsed_docs, landuse_nodes, concepts, PDF_FILES,
                     incremental=IS_SINGLE_FILE,
                     document_entities=document_entities)
    driver.close()
    print(f"  {'[增量] ' if IS_SINGLE_FILE else ''}文档节点: {stats['doc_nodes']}")
    print(f"  用地分类节点: {stats['landuse_nodes']}")
    print(f"  概念节点: {stats['concept_nodes']}")
    print(f"  关系: {stats['relation_count']}")
    print(f"  Doc->Concept 引用: {stats.get('doc_concept_refs', 0)}")
    print(f"  耗时: {time.time() - t0:.1f}s")

    # ---- Step 6: OWL 本体推理 ----
    step("Step 6/6: OWL 本体推理")

    from build_ontology import build_ontology
    from run_reasoning import run_reasoning, write_to_neo4j

    t0 = time.time()
    onto_stats = build_ontology()
    if "error" not in onto_stats:
        reason_stats = run_reasoning()
        write_reasoning_results(write_to_neo4j, reason_stats)
        print(f"  本体: {onto_stats['classes']} 类, {onto_stats['individuals']} 实例")
        print(f"  显式关系: {reason_stats['explicit']} → 推理关系: {reason_stats['inferred']}")
    else:
        print(f"  [跳过] {onto_stats.get('error', '未知错误')}")
    print(f"  耗时: {time.time() - t0:.1f}s")

    # ---- 总结 ----
    total_time = time.time() - start_time
    step("全流程完成")
    print(f"  总耗时: {total_time:.1f}s")
    print(f"  产物:")
    print(f"    SQLite: {SQLITE_DB_PATH} ({os.path.getsize(SQLITE_DB_PATH)//1024} KB)")
    print(f"    TF-IDF: {TFIDF_MODEL_PATH} ({os.path.getsize(TFIDF_MODEL_PATH)//1024} KB)")
    print(f"    Neo4j: http://localhost:7474")
    print(f"\n  验证命令:")
    print(f"    Neo4j Browser -> MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 50")
    print(f"    SQLite -> sqlite3 {SQLITE_DB_PATH} 'SELECT count(*) FROM chunks'")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description='地质文档预处理管线')
    parser.add_argument('--file', type=str, help='单文件 PDF 路径（上传后自动触发）')
    parser.add_argument('--from-step4', action='store_true',
                        help='跳过 Steps 1-3，从已有 SQLite 重建并重跑实体抽取+Neo4j 写入')
    args = parser.parse_args()

    if args.file:
        pdf_path = os.path.abspath(args.file)
        if not os.path.exists(pdf_path):
            print(f"错误: 文件不存在 — {pdf_path}")
            sys.exit(1)
        print(f"[pipeline] 单文件增量模式: {pdf_path}")
        PDF_FILES.clear()
        PDF_FILES.append({"path": pdf_path, "doc_type": "地质"})
        IS_SINGLE_FILE = True

    run()
