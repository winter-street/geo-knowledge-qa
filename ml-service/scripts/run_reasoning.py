"""
OWL 推理脚本 — HermiT 推理机推导隐含关系
1. 加载 geo_planning.owl
2. 记录显式关系（推理前快照）
3. 运行 HermiT 推理（传递性、类层级推理等）
4. 取差集 = 推理出的新关系
5. 写回 Neo4j（以原关系类型 + inferred:true 标记）
"""
import os
import sys
import json
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from owlready2 import get_ontology, sync_reasoner

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OWL_PATH = os.path.join(BASE_DIR, "output", "geo_planning.owl")
INFERENCE_REPORT_PATH = os.path.join(BASE_DIR, "output", "ontology_inference_report.json")

REL_DISPLAY = {
    "HOSTED_IN": "赋存于",
    "CONTROLLED_BY": "受控于",
    "FORMED_IN": "形成于",
    "BELONGS_TO": "属于",
    "ASSOCIATED_WITH": "共生伴生",
    "CUTS": "切穿",
    "LIES_IN": "位于",
    "REFERENCES": "引用",
}

TRANSITIVE_PROPS = {"BELONGS_TO", "LIES_IN"}
CLASS_INFERENCE_CLASSES = (
    "RockHostedMineral",
    "StructurallyControlledMineral",
    "AgeConstrainedMineral",
)
NEO4J_INFERENCE_SOURCE = "owl-run-reasoning"


def _infer_transitive_closure(explicit: set, prop_name: str) -> set:
    """Return only new reachable pairs for a relation with containment semantics."""
    adjacency = {}
    for source, relation, target in explicit:
        if relation == prop_name:
            adjacency.setdefault(source, set()).add(target)

    inferred = set()
    for start in adjacency:
        visited = set()
        queue = list(adjacency[start])
        while queue:
            current = queue.pop(0)
            if current in visited:
                continue
            visited.add(current)
            if (start, prop_name, current) not in explicit:
                inferred.add((start, prop_name, current))
            queue.extend(adjacency.get(current, set()) - visited)
    return inferred


def _apply_geology_rules(known: set) -> set:
    """Apply conservative domain rules without inventing unsupported geology facts."""
    inferred = set()

    # Accompanying or coexisting geology is bidirectional by definition.
    for source, relation, target in known:
        if relation == "ASSOCIATED_WITH" and (target, relation, source) not in known:
            inferred.add((target, relation, source))

    # A mineral's known formation age also belongs to every parent era.
    era_parents = {}
    for source, relation, target in known:
        if relation == "BELONGS_TO":
            era_parents.setdefault(source, set()).add(target)
    for mineral, relation, period in known:
        if relation != "FORMED_IN":
            continue
        for parent in era_parents.get(period, set()):
            fact = (mineral, "FORMED_IN", parent)
            if fact not in known:
                inferred.add(fact)

    return inferred


def _snapshot_relations(onto):
    """记录推理前所有显式关系 → set of (from, relation, to)"""
    explicit = set()
    for prop in onto.object_properties():
        prop_name = prop.name
        for s, o in prop.get_relations():
            explicit.add((_source_name(s), prop_name, _source_name(o)))
    return explicit


def _source_name(individual) -> str:
    """Return the Neo4j/source name stored separately from the OWL-safe IRI."""
    names = getattr(individual, "source_name", [])
    return names[0] if names else individual.name


def _collect_class_inferences(onto) -> dict[str, list[str]]:
    """Collect results of the definition-based OWL class rules for review."""
    results = {}
    for class_name in CLASS_INFERENCE_CLASSES:
        cls = getattr(onto, class_name, None)
        if cls is not None:
            results[class_name] = sorted(_source_name(individual) for individual in cls.instances())
    return results


def _write_inference_report(result: dict) -> None:
    """Persist a reviewable snapshot without altering source entities or labels."""
    report = {
        "explicit_relation_count": result["explicit"],
        "inferred_relation_count": result["inferred"],
        "inferred_relations": result["relations"],
        "class_inferences": result["classifications"],
    }
    with open(INFERENCE_REPORT_PATH, "w", encoding="utf-8") as file:
        json.dump(report, file, ensure_ascii=False, indent=2)


def run_reasoning(owl_path=None):
    """运行 HermiT 推理，返回显式/推理关系统计"""
    if owl_path is None:
        owl_path = OWL_PATH

    print("=== OWL 推理（HermiT）===\n")

    if not os.path.exists(owl_path):
        print(f"  本体文件不存在: {owl_path}")
        print("  请先运行 build_ontology.py")
        return {"explicit": 0, "inferred": 0, "relations": []}

    # 1. 加载本体
    print("[1/4] 加载本体...")
    onto = get_ontology(owl_path).load()
    print(f"  类: {len(list(onto.classes()))}")
    print(f"  实例: {len(list(onto.individuals()))}")

    # 2. 记录显式关系 + 传递闭包推导
    print("[2/4] 推导推理关系 (传递闭包)...")
    explicit = _snapshot_relations(onto)

    inferred = set()

    # 也检查 HermiT 推理（类层级等）
    print("[3/4] 运行 HermiT 推理机 (类层级)...")
    for prop_name in TRANSITIVE_PROPS:
        inferred |= _infer_transitive_closure(explicit, prop_name)

    # Let newly inferred parent eras participate in the formation-age rule.
    while True:
        additions = _apply_geology_rules(explicit | inferred) - inferred
        if not additions:
            break
        inferred |= additions

    try:
        with onto:
            sync_reasoner()
        print("  推理完成!")
    except Exception as e:
        print(f"  推理失败: {e} (传递闭包已完成)")

    # 合并 HermiT 推理结果
    print("[4/4] 提取推理关系...")
    all_relations = set()
    for prop in onto.object_properties():
        for s, o in prop.get_relations():
            all_relations.add((_source_name(s), prop.name, _source_name(o)))

    inferred |= (all_relations - explicit)

    classifications = _collect_class_inferences(onto)
    print("  定义类推理:")
    for class_name, individuals in classifications.items():
        print(f"    {class_name}: {len(individuals)}")

    inferred_list = [
        {"from": f, "relation": r, "to": t}
        for f, r, t in sorted(inferred)
    ]

    print(f"  显式关系: {len(explicit)}")
    print(f"  推理关系: {len(inferred_list)}")
    if inferred_list:
        print("  推理明细:")
        for rel in inferred_list[:20]:
            print(f"    {rel['from']} -[{rel['relation']}]-> {rel['to']}")
        if len(inferred_list) > 20:
            print(f"    ... 等 {len(inferred_list) - 20} 条")

    result = {
        "explicit": len(explicit),
        "inferred": len(inferred_list),
        "relations": inferred_list,
        "classifications": classifications,
    }
    _write_inference_report(result)
    return result


def _classification_rows(classifications):
    """Merge several inferred OWL classes for the same Neo4j Mineral node."""
    by_name = {}
    for class_name, names in classifications.items():
        for name in names:
            by_name.setdefault(name, []).append(class_name)
    return [
        {"name": name, "types": sorted(set(types))}
        for name, types in sorted(by_name.items())
    ]


def write_to_neo4j(inferred_rels, classifications=None):
    """Write inferred relations and OWL class memberships back to Neo4j."""
    classifications = classifications or {}
    class_rows = _classification_rows(classifications)
    if not inferred_rels and not class_rows:
        print("\n[跳过] 无推理关系或类别需要写入")
        return 0

    try:
        from neo4j import GraphDatabase
        from config import NEO4J_CONFIG

        driver = GraphDatabase.driver(
            NEO4J_CONFIG["uri"],
            auth=(NEO4J_CONFIG["user"], NEO4J_CONFIG["password"]),
        )
        with driver.session() as s:
            s.run("RETURN 1").single()

        written = 0
        with driver.session() as session:
            for rel in inferred_rels:
                rel_type = rel["relation"]
                display = REL_DISPLAY.get(rel_type, rel_type)
                try:
                    session.run(
                        f"MATCH (a {{name: $from_name}}) "
                        f"MATCH (b {{name: $to_name}}) "
                        f"MERGE (a)-[:{rel_type} {{display: $display, inferred: true}}]->(b)",
                        from_name=rel["from"],
                        to_name=rel["to"],
                        display=display,
                    )
                    written += 1
                except Exception:
                    pass  # 实体不存在则跳过

            # Replace only values managed by this reasoning script, so stale
            # class memberships disappear after ontology/rule changes.
            session.run(
                "MATCH (n {owlInferenceSource: $source}) "
                "REMOVE n.owlTypes, n.owlInferred, n.owlInferenceSource, "
                "n.owlReasoningUpdatedAt",
                source=NEO4J_INFERENCE_SOURCE,
            ).consume()

            classified = 0
            if class_rows:
                matched_count = session.run(
                    "UNWIND $rows AS row "
                    "MATCH (n:Mineral {name: row.name}) "
                    "SET n.owlTypes = row.types, "
                    "n.owlInferred = true, "
                    "n.owlInferenceSource = $source, "
                    "n.owlReasoningUpdatedAt = $updatedAt "
                    "RETURN count(n) AS total",
                    rows=class_rows,
                    source=NEO4J_INFERENCE_SOURCE,
                    updatedAt=datetime.now(timezone.utc).isoformat(),
                ).single()["total"]
                classified = int(matched_count)

        driver.close()
        print(f"\n[Neo4j] 写入 {written}/{len(inferred_rels)} 条推理关系 (inferred=true)")
        print(f"[Neo4j] 同步 {classified}/{len(class_rows)} 个 OWL 推理分类节点 (owlTypes)")
        return written

    except Exception as e:
        print(f"\n[Neo4j] 不可用 ({e})，跳过写入")
        return 0


if __name__ == "__main__":
    result = run_reasoning()
    write_to_neo4j(result["relations"], result["classifications"])
    print(f"\n=== 完成 ===")
    print(f"  显式关系: {result['explicit']}")
    print(f"  推理关系: {result['inferred']}")
