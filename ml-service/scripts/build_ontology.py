"""
构建地质知识图谱 OWL 本体
- 从 Neo4j 动态读取地质实体 + 关系
- 定义类层级（Mineral/Rock/Structure/TimePeriod/DepositType/Document）
- 定义关系属性（HOSTED_IN/CONTROLLED_BY/FORMED_IN/BELONGS_TO/ASSOCIATED_WITH/CUTS/REFERENCES）
- 设置传递性公理（BELONGS_TO, CONTROLLED_BY）
- 输出: ml-service/output/geo_planning.owl
"""
import os
import sys
import hashlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from owlready2 import (
    get_ontology,
    Thing,
    ObjectProperty,
    TransitiveProperty,
    DataProperty,
)

# ---- 路径 ----
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
OWL_PATH = os.path.join(OUTPUT_DIR, "geo_planning.owl")

# 地质实体标签 → OWL 类名
GEO_LABELS = ["Mineral", "Rock", "Structure", "TimePeriod", "DepositType", "Region", "Document"]

# 关系类型白名单
RELATION_TYPES = [
    "HOSTED_IN", "CONTROLLED_BY", "FORMED_IN", "BELONGS_TO",
    "ASSOCIATED_WITH", "CUTS", "LIES_IN", "REFERENCES",
]

# 传递性属性：推理机可沿这些关系传递
TRANSITIVE_PROPS = {"BELONGS_TO", "LIES_IN"}
SYMMETRIC_PROPS = {"ASSOCIATED_WITH"}

# 关系显示名
REL_DISPLAY = {
    "HOSTED_IN": "赋存于",
    "CONTROLLED_BY": "受控于",
    "FORMED_IN": "形成于",
    "BELONGS_TO": "属于",
    "ASSOCIATED_WITH": "共生伴生",
    "CUTS": "切穿",
    "REFERENCES": "引用",
}


# Semantic subclasses are derived conservatively from existing entity names.
# They improve the OWL layer without changing the raw Neo4j labels generated
# by the current five-type NER pipeline.
SEMANTIC_CLASS_SPECS = [
    ("MineralCommodity", "Mineral"),
    ("MineralSpecies", "Mineral"),
    ("OreDeposit", "GeoEntity"),
    ("OreBody", "OreDeposit"),
    ("IgneousRock", "Rock"),
    ("SedimentaryRock", "Rock"),
    ("MetamorphicRock", "Rock"),
    ("GeologicUnit", "GeoEntity"),
    ("StratigraphicUnit", "GeologicUnit"),
    ("Intrusion", "GeologicUnit"),
    ("Fault", "Structure"),
    ("Fold", "Structure"),
    ("TectonicZone", "Structure"),
    ("Eon", "TimePeriod"),
    ("Era", "TimePeriod"),
    ("Period", "TimePeriod"),
    ("Epoch", "TimePeriod"),
    ("TectonicStage", "TimePeriod"),
    ("MagmaticDeposit", "DepositType"),
    ("HydrothermalDeposit", "DepositType"),
    ("SedimentaryDeposit", "DepositType"),
    ("MetamorphicDeposit", "DepositType"),
    ("MineralizationEvent", "GeoEntity"),
    ("RockHostedMineral", "Mineral"),
    ("StructurallyControlledMineral", "Mineral"),
    ("AgeConstrainedMineral", "Mineral"),
]

# The extraction model also returns sentence fragments.  For mineral names,
# substring matching would turn e.g. "铁矿中" into a commodity, so only use
# this short controlled vocabulary for the finer Mineral classes.
MINERAL_COMMODITIES = {
    "铁矿", "钛矿", "钒矿", "铜矿", "镍矿", "铬矿", "金矿", "稀土",
    "铌矿", "锆矿", "铜镍矿",
}
MINERAL_SPECIES = {
    "镁钛铁矿", "钛铁矿", "磁铁矿", "钛磁铁矿", "钒钛磁铁矿", "磁黄铁矿",
    "黄铁矿", "黄铜矿", "镍黄铁矿", "赤铁矿", "铬铁矿", "闪锌矿",
    "方铅矿", "金红石", "斑铜矿",
}
GEOLOGIC_PERIODS = {
    "寒武纪", "奥陶纪", "志留纪", "泥盆纪", "石炭纪", "二叠纪", "三叠纪",
    "侏罗纪", "白垩纪", "古近纪", "新近纪", "第四纪",
    "寒武系", "奥陶系", "志留系", "泥盆系", "石炭系", "二叠系", "三叠系",
    "侏罗系", "白垩系", "古近系", "新近系", "第四系",
}


def _contains_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


def _endswith_any(text: str, suffixes: tuple[str, ...]) -> bool:
    return text.endswith(suffixes)


def _individual_id(source_name: str) -> str:
    """Use an ASCII IRI fragment; source NER terms may contain punctuation/spaces."""
    digest = hashlib.sha256(source_name.encode("utf-8")).hexdigest()[:20]
    return f"entity_{digest}"


def _is_clean_term(name: str) -> bool:
    """Reject common NER fragments before assigning a stronger semantic class."""
    if not 2 <= len(name) <= 24 or "的" in name:
        return False
    return not _contains_any(name, (
        "相关", "该矿", "本矿", "矿区是", "矿体采", "岩体中", "岩体相", "岩体角",
        "主要", "一般", "地区", "工作区", "研究区", "形成时代", "成矿时代", "演化阶段",
        "，", "、", "；", "：", "（", "）", "《", "》",
    ))


def classify_entity(label: str, name: str) -> list[str]:
    """Map a coarse extraction label to one precise OWL class when evidence is lexical."""
    if label == "Mineral":
        if _is_clean_term(name) and len(name) >= 5 and name.endswith("矿体"):
            return ["OreBody"]
        if _is_clean_term(name) and len(name) >= 5 and name.endswith(("矿床", "矿区", "矿田", "矿带", "矿山", "矿点")):
            return ["OreDeposit"]
        if name in MINERAL_SPECIES:
            return ["MineralSpecies"]
        if name in MINERAL_COMMODITIES:
            return ["MineralCommodity"]
        return []

    if label == "Rock":
        if _is_clean_term(name) and len(name) >= 5 and name.endswith("岩体"):
            return ["Intrusion"]
        if _is_clean_term(name) and _contains_any(name, ("片岩", "片麻岩", "大理岩", "板岩", "千枚岩", "变质", "角岩")):
            return ["MetamorphicRock"]
        if _is_clean_term(name) and _contains_any(name, ("砂岩", "泥岩", "页岩", "灰岩", "砾岩", "粉砂岩", "碳酸盐岩")):
            return ["SedimentaryRock"]
        if _is_clean_term(name) and _contains_any(name, ("辉长岩", "花岗岩", "玄武岩", "橄榄岩", "辉石岩", "闪长岩", "正长岩", "岩浆岩")):
            return ["IgneousRock"]

    if label == "Structure":
        if _is_clean_term(name) and _contains_any(name, ("断裂", "断层", "走滑")):
            return ["Fault"]
        if _is_clean_term(name) and _contains_any(name, ("褶皱", "背斜", "向斜")):
            return ["Fold"]
        if _is_clean_term(name) and _contains_any(name, ("构造带", "剪切带", "缝合带", "造山带", "混杂岩带")):
            return ["TectonicZone"]

    if label == "TimePeriod":
        if _is_clean_term(name) and _endswith_any(name, ("组", "群", "段", "层")):
            return ["StratigraphicUnit"]
        if _is_clean_term(name) and name.endswith("宙"):
            return ["Eon"]
        if _is_clean_term(name) and name.endswith("代"):
            return ["Era"]
        if name in GEOLOGIC_PERIODS:
            return ["Period"]
        if _is_clean_term(name) and name.endswith("世"):
            return ["Epoch"]
        if _is_clean_term(name) and name.endswith("期"):
            return ["TectonicStage"]

    if label == "DepositType":
        if not (_is_clean_term(name) and _endswith_any(name, ("型", "型矿床"))):
            return []
        markers = {
            "MagmaticDeposit": _contains_any(name, ("岩浆", "分异", "侵入", "熔离")),
            "HydrothermalDeposit": _contains_any(name, ("热液",)),
            "SedimentaryDeposit": _contains_any(name, ("沉积", "砂矿")),
            "MetamorphicDeposit": _contains_any(name, ("变质", "接触交代")),
        }
        matching_classes = [class_name for class_name, matched in markers.items() if matched]
        if len(matching_classes) == 1:
            return matching_classes
        return []

    return []


def _connect_neo4j():
    """连接 Neo4j，失败返回 None"""
    try:
        from neo4j import GraphDatabase
        from config import NEO4J_CONFIG
        driver = GraphDatabase.driver(
            NEO4J_CONFIG["uri"],
            auth=(NEO4J_CONFIG["user"], NEO4J_CONFIG["password"]),
        )
        with driver.session() as s:
            s.run("RETURN 1").single()
        return driver
    except Exception as e:
        print(f"[ontology] Neo4j 不可用: {e}")
        return None


def _read_entities(driver):
    """从 Neo4j 读取所有地质实体，返回 {label: [{name, description}]}"""
    entities = {lbl: [] for lbl in GEO_LABELS}
    with driver.session() as s:
        for label in GEO_LABELS:
            name_field = "n.title" if label == "Document" else "n.name"
            result = s.run(
                f"MATCH (n:{label}) RETURN {name_field} AS name, n.description AS description"
            )
            for r in result:
                name = r["name"]
                desc = r["description"] or ""
                if name:
                    entities[label].append({"name": name, "description": desc})
    return entities


def _read_relations(driver):
    """从 Neo4j 读取所有关系，返回 [{from, relation, to}]"""
    relations = []
    with driver.session() as s:
        result = s.run(
            "MATCH (a)-[r]->(b) "
            "WHERE type(r) IN $types AND coalesce(r.inferred, false) = false "
            "RETURN COALESCE(a.name, a.title) AS a_name, type(r) AS rel, "
            "COALESCE(b.name, b.title) AS b_name, r.display AS display",
            types=RELATION_TYPES,
        )
        for r in result:
            a_name = r["a_name"]
            b_name = r["b_name"]
            rel = r["rel"]
            if a_name and b_name and rel in RELATION_TYPES:
                relations.append({
                    "from": a_name,
                    "relation": rel,
                    "to": b_name,
                    "display": r["display"] or REL_DISPLAY.get(rel, rel),
                })
    return relations


def build_ontology():
    """从 Neo4j 读取地质实体 + 关系，动态构建 OWL 本体。"""
    print("=== 构建地质知识图谱 OWL 本体 ===\n")

    driver = _connect_neo4j()
    if not driver:
        return {"error": "Neo4j 不可用，跳过本体构建"}

    # 读取数据
    print("[1/5] 从 Neo4j 读取数据...")
    entities = _read_entities(driver)
    relations = _read_relations(driver)
    driver.close()

    total_entities = sum(len(v) for v in entities.values())
    print(f"  实体: {total_entities}")
    for lbl in GEO_LABELS:
        print(f"    {lbl}: {len(entities[lbl])}")
    print(f"  关系: {len(relations)}")

    if total_entities == 0:
        print("  [ontology] Neo4j 无地质实体，跳过本体构建")
        return {"error": "无地质实体", "classes": 0, "individuals": 0, "properties": 0}

    # 构建本体
    print("[2/5] 定义类层级...")
    onto = get_ontology("http://geo-knowledge.edu.cn/geology#")

    with onto:
        # 抽象父类
        class GeoEntity(Thing):
            pass

        # 地质实体类（动态创建，映射 Neo4j 标签）
        owl_classes = {}
        for label in GEO_LABELS:
            cls = type(label, (GeoEntity,), {})
            owl_classes[label] = cls

        semantic_classes = {}
        for class_name, parent_name in SEMANTIC_CLASS_SPECS:
            parent = GeoEntity if parent_name == "GeoEntity" else (
                semantic_classes.get(parent_name) or owl_classes[parent_name]
            )
            semantic_classes[class_name] = type(class_name, (parent,), {})

        # 数据属性
        class has_description(DataProperty):
            domain = [GeoEntity]
            range = [str]

        class source_name(DataProperty):
            domain = [GeoEntity]
            range = [str]

        # 关系属性（动态创建，映射 Neo4j 关系类型）
        owl_props = {}
        print("[3/5] 定义关系属性 + 地质年代层级...")

        for rel_type in RELATION_TYPES:
            bases = [ObjectProperty]
            if rel_type in TRANSITIVE_PROPS:
                bases.append(TransitiveProperty)
            prop = type(rel_type, tuple(bases), {
                "domain": [GeoEntity],
                "range": [GeoEntity],
            })
            owl_props[rel_type] = prop

        # These are definition-based classes, rather than name heuristics:
        # an individual joins them only when the source graph supplies both
        # the required entity type and the supporting relation.
        semantic_classes["RockHostedMineral"].equivalent_to.append(
            owl_classes["Mineral"] & owl_props["HOSTED_IN"].some(owl_classes["Rock"])
        )
        semantic_classes["StructurallyControlledMineral"].equivalent_to.append(
            owl_classes["Mineral"] & owl_props["CONTROLLED_BY"].some(owl_classes["Structure"])
        )
        semantic_classes["AgeConstrainedMineral"].equivalent_to.append(
            owl_classes["Mineral"] & owl_props["FORMED_IN"].some(owl_classes["TimePeriod"])
        )

        # 地质年代层级（硬编码，用于传递性推理）
        # 例：二叠纪 BELONGS_TO 古生代 → 古生代 BELONGS_TO 显生宙 → 推理出 二叠纪 BELONGS_TO 显生宙
        ERA_HIERARCHY = {
            "早二叠世": "二叠纪", "中二叠世": "二叠纪", "晚二叠世": "二叠纪",
            "早三叠世": "三叠纪", "中三叠世": "三叠纪", "晚三叠世": "三叠纪",
            "早侏罗世": "侏罗纪", "中侏罗世": "侏罗纪", "晚侏罗世": "侏罗纪",
            "早白垩世": "白垩纪", "晚白垩世": "白垩纪",
            "早石炭世": "石炭纪", "晚石炭世": "石炭纪",
            "早寒武世": "寒武纪", "中寒武世": "寒武纪", "晚寒武世": "寒武纪",
            "早奥陶世": "奥陶纪", "中奥陶世": "奥陶纪", "晚奥陶世": "奥陶纪",
            "早志留世": "志留纪", "中志留世": "志留纪", "晚志留世": "志留纪",
            "早泥盆世": "泥盆纪", "中泥盆世": "泥盆纪", "晚泥盆世": "泥盆纪",
            "古新世": "古近纪", "始新世": "古近纪", "渐新世": "古近纪",
            "中新世": "新近纪", "上新世": "新近纪",
            "更新世": "第四纪", "全新世": "第四纪",
            # 纪→代
            "二叠纪": "古生代", "三叠纪": "中生代", "侏罗纪": "中生代", "白垩纪": "中生代",
            "寒武纪": "古生代", "奥陶纪": "古生代", "志留纪": "古生代",
            "泥盆纪": "古生代", "石炭纪": "古生代",
            "古近纪": "新生代", "新近纪": "新生代", "第四纪": "新生代",
            # 代→宙
            "古生代": "显生宙", "中生代": "显生宙", "新生代": "显生宙",
        }

    # 创建实例
    print("[4/5] 创建实例...")
    instance_map = {}  # source name → OWL individual
    individual_map = {}  # stable ASCII ID → OWL individual
    semantic_class_counts = {class_name: 0 for class_name, _ in SEMANTIC_CLASS_SPECS}
    for label in GEO_LABELS:
        for e in entities[label]:
            class_names = classify_entity(label, e["name"])
            individual_id = _individual_id(e["name"])
            inst = individual_map.get(individual_id)
            if inst is None:
                inst = owl_classes[label](individual_id)
                inst.source_name = [e["name"]]
                individual_map[individual_id] = inst
            elif owl_classes[label] not in inst.is_a:
                inst.is_a.append(owl_classes[label])
            for class_name in class_names:
                if semantic_classes[class_name] not in inst.is_a:
                    inst.is_a.append(semantic_classes[class_name])
            if e["description"]:
                inst.has_description = [e["description"]]
            instance_map[e["name"]] = inst
            if class_names:
                semantic_class_counts[class_names[0]] += 1

    # 注册显式关系（Neo4j）
    print(f"  注册 {len(relations)} 条显式关系（Neo4j）...")
    rel_count = 0
    for r in relations:
        a = instance_map.get(r["from"])
        b = instance_map.get(r["to"])
        prop = owl_props.get(r["relation"])
        if a and b and prop:
            getattr(a, r["relation"]).append(b)
            rel_count += 1

    # 注册地质年代层级（硬编码，传递性推理用）
    print(f"  注册 {len(ERA_HIERARCHY)} 条地质年代层级...")
    era_count = 0
    bel_prop = owl_props["BELONGS_TO"]
    for child, parent in ERA_HIERARCHY.items():
        a = instance_map.get(child)
        b = instance_map.get(parent)
        if a and b:
            a.BELONGS_TO.append(b)
            era_count += 1
    rel_count += era_count

    # 保存
    print("[5/5] 保存 OWL 文件...")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    onto.save(file=OWL_PATH, format="rdfxml")

    classes = list(onto.classes())
    individuals = list(onto.individuals())
    obj_props = list(onto.object_properties())

    stats = {
        "classes": len(classes),
        "individuals": len(individuals),
        "properties": len(obj_props),
        "explicit_relations": rel_count,
        "semantic_class_counts": semantic_class_counts,
    }

    print(f"\n=== 完成 ===")
    print(f"  类: {stats['classes']}")
    print(f"  实例: {stats['individuals']}")
    print(f"  对象属性: {stats['properties']}")
    print(f"  显式关系: {stats['explicit_relations']}")
    print(f"  输出: {OWL_PATH}")

    # 生成报告
    report_path = os.path.join(OUTPUT_DIR, "ontology_report.txt")
    _write_report(report_path, stats, entities, relations, owl_classes)

    return stats


def _write_report(path, stats, entities, relations, owl_classes):
    """生成本体构建报告"""
    lines = ["=== 地质知识图谱 OWL 本体报告 ===\n"]
    lines.append(f"类: {stats['classes']}")
    lines.append(f"实例: {stats['individuals']}")
    lines.append(f"对象属性: {stats['properties']}")
    lines.append(f"显式关系: {stats['explicit_relations']}\n")

    lines.append("--- 实体分布 ---")
    for lbl in GEO_LABELS:
        names = [e["name"] for e in entities[lbl]]
        sample = ", ".join(names[:10])
        lines.append(f"{lbl} ({len(names)}):" + (f" {sample}" if sample else "")
                     + (" ..." if len(names) > 10 else ""))

    lines.append("\n--- 语义子类归类 ---")
    for class_name, count in stats.get("semantic_class_counts", {}).items():
        if count:
            lines.append(f"{class_name}: {count}")

    lines.append(f"\n--- 关系类型分布 ---")
    rel_counts = {}
    for r in relations:
        rel_counts[r["relation"]] = rel_counts.get(r["relation"], 0) + 1
    for rt, cnt in sorted(rel_counts.items()):
        lines.append(f"  {rt}: {cnt}")

    lines.append(f"\n--- 传递性属性 ---")
    for prop_name in TRANSITIVE_PROPS:
        lines.append(f"  {prop_name}: transitive=True")
    lines.append(f"\n--- 对称属性 ---")
    for prop_name in SYMMETRIC_PROPS:
        lines.append(f"  {prop_name}: symmetric_rule=True")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"  报告: {path}")


if __name__ == "__main__":
    build_ontology()
