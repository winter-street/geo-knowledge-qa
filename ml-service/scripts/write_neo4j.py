"""
Neo4j 批量写入脚本 —— 节点 + 关系
从 extract_landuse 和 extract_concepts 获取数据，写入 Neo4j
"""
from neo4j import GraphDatabase
try:
    from entity_quality import validate_entity
except ModuleNotFoundError:
    from scripts.entity_quality import validate_entity


# ---- 连接管理 ----

def connect_neo4j(config: dict):
    """建立 Neo4j 连接，返回 driver"""
    uri = config["uri"]
    user = config["user"]
    password = config["password"]
    return GraphDatabase.driver(uri, auth=(user, password))


def clear_all_data(driver):
    """清空数据库中的所有节点和关系（谨慎使用）"""
    with driver.session() as session:
        session.run("MATCH (n) DETACH DELETE n")


# ---- 写入用地分类 ----

def write_landuse_nodes(driver, nodes: list) -> int:
    """
    批量写入用地分类节点及 BELONGS_TO 关系。
    """
    count = 0
    with driver.session() as session:
        for n in nodes:
            session.run(
                """MERGE (l:LandUse {code: $code})
                   SET l.name = $name, l.level = $level""",
                name=n["name"], code=n["code"], level=n["level"],
            )
            count += 1

        # 创建父子关系（中类→大类）
        for n in nodes:
            if n.get("parent_code"):
                session.run(
                    """MATCH (child:LandUse {code: $child_code})
                       MATCH (parent:LandUse {code: $parent_code})
                       MERGE (child)-[:BELONGS_TO {display: $display}]->(parent)""",
                    child_code=n["code"], parent_code=n["parent_code"],
                    display="属于",
                )

    return count


# ---- 写入概念（国土规划旧版，保留兼容） ----

def write_concept_nodes(driver, concepts: list, relations: list) -> tuple:
    """
    批量写入规划概念节点及关系（LandUse/Concept 旧 schema）。
    """
    node_count = 0
    rel_count = 0

    with driver.session() as session:
        for c in concepts:
            session.run(
                """MERGE (n:Concept {name: $name})
                   SET n.type = $type, n.description = $description""",
                name=c["name"], type=c["type"],
                description=c.get("description", ""),
            )
            node_count += 1

        rel_display = {
            "BELONGS_TO": "属于",
            "GOVERNS": "管控",
            "CONSTRAINS": "约束",
            "REFERENCES": "引用",
        }
        for r in relations:
            display = rel_display.get(r["relation"], r["relation"])
            session.run(
                f"""MATCH (a:Concept {{name: $from_name}})
                   MATCH (b:Concept {{name: $to_name}})
                   MERGE (a)-[:{r['relation']} {{display: $display}}]->(b)""",
                from_name=r["from"], to_name=r["to"], display=display,
            )
            rel_count += 1

    return node_count, rel_count


# ---- 写入地质实体（新 Schema） ----

REL_DISPLAY = {
    "HOSTED_IN": "赋存于",
    "CONTROLLED_BY": "受控于",
    "FORMED_IN": "形成于",
    "BELONGS_TO": "属于",
    "ASSOCIATED_WITH": "共生伴生",
    "REFERENCES": "引用",
}


def write_geology_entities(driver, concepts: list, relations: list) -> tuple:
    """
    批量写入地质实体节点及关系。

    每个 concept 的 type 字段（Mineral/Rock/Structure/TimePeriod/DepositType）
    直接映射为 Neo4j 节点标签。坐标属性 (lng/lat) 如果有则写入。
    """
    node_count = 0
    rel_count = 0

    with driver.session() as session:
        # 创建实体节点（按 type 分标签）
        for c in concepts:
            entity_type = c.get("type", "Concept")
            validation = validate_entity(c.get("name", ""), entity_type)
            if not validation.valid:
                continue
            name = validation.name
            desc = c.get("description", "")
            lng = c.get("lng")
            lat = c.get("lat")

            if lng is not None and lat is not None:
                session.run(
                    f"MERGE (n:{entity_type} {{name: $name}}) "
                    f"SET n.type = $type, n.description = $description, "
                    f"n.lng = $lng, n.lat = $lat",
                    name=name, type=entity_type, description=desc,
                    lng=float(lng), lat=float(lat),
                )
            else:
                session.run(
                    f"MERGE (n:{entity_type} {{name: $name}}) "
                    f"SET n.type = $type, n.description = $description",
                    name=name, type=entity_type, description=desc,
                )
            node_count += 1

        # 创建实体间关系
        for r in relations:
            rel_type = r["relation"]
            display = REL_DISPLAY.get(rel_type, rel_type)
            from_name = r["from"]
            to_name = r["to"]
            session.run(
                f"MATCH (a {{name: $from_name}}) "
                f"MATCH (b {{name: $to_name}}) "
                f"MERGE (a)-[:{rel_type} {{display: $display}}]->(b)",
                from_name=from_name, to_name=to_name, display=display,
            )
            rel_count += 1

    return node_count, rel_count


# ---- 写入文档 ----

def write_document_node(driver, parsed_doc: dict, doc_type: str = "") -> int:
    """写入文档节点到 Neo4j。"""
    with driver.session() as session:
        session.run(
            """MERGE (d:Document {title: $title})
               SET d.docType = $doc_type, d.pages = $pages""",
            title=parsed_doc["title"],
            doc_type=doc_type,
            pages=parsed_doc["total_pages"],
        )
    return 1


# ---- 主入口 ----

def write_all(driver, parsed_docs: list, landuse_nodes: list,
              concepts: dict, pdf_files: list,
              incremental: bool = False,
              document_entities: dict | None = None) -> dict:
    """
    一键写入所有数据到 Neo4j。

    Args:
        incremental: True 时跳过清空（上传后追加模式）
        document_entities: 文档标题到该文档实体名称列表的映射。
    """
    stats = {}

    # 增量模式不清空现有数据
    if not incremental:
        clear_all_data(driver)

    # 写入文档节点
    stats["doc_nodes"] = 0
    for parsed in parsed_docs:
        doc_type = ""
        for pf in pdf_files:
            if pf["path"].endswith(parsed["title"] + ".pdf") or \
               parsed["title"] in pf["path"]:
                doc_type = pf["doc_type"]
                break
        write_document_node(driver, parsed, doc_type)
        stats["doc_nodes"] += 1

    # 写入用地分类（旧 schema）
    stats["landuse_nodes"] = write_landuse_nodes(driver, landuse_nodes)

    # 写入实体：判断是地质 schema 还是旧 schema
    raw_concepts = concepts.get("concepts", [])
    raw_relations = concepts.get("relations", [])

    if raw_concepts:
        first_type = raw_concepts[0].get("type", "")
        if first_type in ("Mineral", "Rock", "Structure", "TimePeriod", "DepositType"):
            # 地质 schema → 按标签分节点
            cn, rn = write_geology_entities(driver, raw_concepts, raw_relations)
        else:
            # 旧 schema → Concept 节点
            cn, rn = write_concept_nodes(driver, raw_concepts, raw_relations)
    else:
        cn, rn = 0, 0

    stats["concept_nodes"] = cn
    stats["relation_count"] = rn

    # Document → Entity 引用关联
    stats["doc_concept_refs"] = 0
    document_entities = document_entities or {}
    with driver.session() as session:
        for parsed in parsed_docs:
            for entity in document_entities.get(parsed["title"], []):
                try:
                    entity_name = entity["name"] if isinstance(entity, dict) else entity
                    entity_type = entity.get("type") if isinstance(entity, dict) else None
                    result = session.run(
                        """MATCH (d:Document {title: $title})
                           MATCH (e {name: $name})
                           WHERE any(label IN labels(e) WHERE label IN
                             ['Mineral', 'Rock', 'Structure', 'TimePeriod', 'DepositType', 'Region'])
                             AND ($type IS NULL OR $type IN labels(e))
                           MERGE (d)-[:REFERENCES {display: $display}]->(e)
                           RETURN count(e) AS matched""",
                        title=parsed["title"], name=entity_name,
                        type=entity_type,
                        display="引用",
                    )
                    record = result.single()
                    stats["doc_concept_refs"] += record["matched"] if record else 0
                except Exception:
                    pass  # 实体可能不存在（dry_run 等场景）

    return stats


if __name__ == "__main__":
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from config import PDF_FILES, NEO4J_CONFIG
    from parse_pdf import parse_pdf
    from extract_landuse import extract_landuse
    from extract_concepts import extract_concepts, LLM_CONFIG

    print("=== 连接 Neo4j ===")
    driver = connect_neo4j(NEO4J_CONFIG)
    print("连接成功, 清空现有数据...")
    clear_all_data(driver)

    parsed_docs = []
    landuse_nodes = []
    concepts = {"concepts": [], "relations": []}
    document_entities = {}

    for pdf_info in PDF_FILES:
        print(f"\n解析: {os.path.basename(pdf_info['path'])}")
        parsed = parse_pdf(pdf_info["path"])

        if pdf_info["doc_type"] == "用地分类":
            landuse_nodes = extract_landuse(parsed)
            print(f"  提取用地分类: {len(landuse_nodes)} 节点")
        elif pdf_info["doc_type"] == "编制指南":
            doc_concepts = extract_concepts(parsed, LLM_CONFIG, dry_run=True)
            concepts["concepts"].extend(doc_concepts.get("concepts", []))
            concepts["relations"].extend(doc_concepts.get("relations", []))
            document_entities[parsed["title"]] = [
                {"name": name, "type": entity_type}
                for name, entity_type in sorted({
                    (c["name"], c.get("type", "Concept"))
                    for c in doc_concepts.get("concepts", []) if c.get("name")
                })
            ]
            print(f"  提取概念(DRY RUN): {len(doc_concepts['concepts'])} 概念")
        elif pdf_info["doc_type"] == "地质":
            geo = extract_concepts(parsed, LLM_CONFIG, dry_run=True)
            concepts["concepts"].extend(geo.get("concepts", []))
            concepts["relations"].extend(geo.get("relations", []))
            document_entities[parsed["title"]] = [
                {"name": name, "type": entity_type}
                for name, entity_type in sorted({
                    (c["name"], c.get("type", "Concept"))
                    for c in geo.get("concepts", []) if c.get("name")
                })
            ]
            print(f"  提取地质实体(DRY RUN): {len(geo.get('concepts', []))} 实体")

        parsed_docs.append(parsed)

    print("\n=== 写入 Neo4j ===")
    stats = write_all(
        driver, parsed_docs, landuse_nodes, concepts, PDF_FILES,
        document_entities=document_entities,
    )
    print(f"  文档节点: {stats['doc_nodes']}")
    print(f"  用地分类节点: {stats['landuse_nodes']}")
    print(f"  实体节点: {stats['concept_nodes']}")
    print(f"  关系: {stats['relation_count']}")

    driver.close()
    print("\n验证: 打开 http://localhost:7474 执行 MATCH (n) RETURN n LIMIT 50")
