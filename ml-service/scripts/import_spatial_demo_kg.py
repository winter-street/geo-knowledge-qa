"""Import, verify or remove source-scoped spatial demonstration KG data."""

import argparse
import sys
from pathlib import Path

from spatial_demo_kg_data import REGIONS


SOURCE = "spatial-demo-v1"

NODE_SPECS = (
    ("Rock", "host_rock"),
    ("Structure", "structure"),
    ("TimePeriod", "time_period"),
    ("DepositType", "deposit_type"),
)

RELATION_SPECS = (
    ("LIES_IN", "region_name", "位于"),
    ("HOSTED_IN", "host_rock", "赋存于"),
    ("CONTROLLED_BY", "structure", "受控于"),
    ("FORMED_IN", "time_period", "形成于"),
)


def _create_named_node(tx, label, name):
    tx.run(
        f"""MERGE (n:{label} {{name: $name}})
            ON CREATE SET n.isMock = true, n.source = $source""",
        name=name,
        source=SOURCE,
    )


def _create_relationship(tx, relation_type, from_name, to_name, display):
    tx.run(
        f"""MATCH (a {{name: $from_name}}), (b {{name: $to_name}})
            MERGE (a)-[r:{relation_type} {{source: $source}}]->(b)
            SET r.isMock = true, r.display = $display""",
        from_name=from_name,
        to_name=to_name,
        source=SOURCE,
        display=display,
    )


def _import_region(tx, region):
    region_name = region["name"]
    _create_named_node(tx, "Region", region_name)

    for item in region["anchors"]:
        tx.run(
            """MERGE (n:Mineral {name: $name})
               ON CREATE SET n.isMock = true, n.source = $source,
                             n.mockLng = $mock_lng, n.mockLat = $mock_lat
               ON MATCH SET n.mockLng = coalesce(n.mockLng, $mock_lng),
                            n.mockLat = coalesce(n.mockLat, $mock_lat)""",
            name=item["name"],
            source=SOURCE,
            mock_lng=item["mock_lng"],
            mock_lat=item["mock_lat"],
        )
        for label, key in NODE_SPECS:
            _create_named_node(tx, label, item[key])

        relationship_values = {**item, "region_name": region_name}
        for relation_type, target_key, display in RELATION_SPECS:
            _create_relationship(
                tx,
                relation_type,
                item["name"],
                relationship_values[target_key],
                display,
            )


def import_demo_kg(driver):
    with driver.session() as session:
        for region in REGIONS:
            session.execute_write(_import_region, region)
    anchor_count = sum(len(region["anchors"]) for region in REGIONS)
    return {
        "regions": len(REGIONS),
        "anchors": anchor_count,
        "relationships": anchor_count * len(RELATION_SPECS),
        "source": SOURCE,
    }


def _count(session, query):
    record = session.run(query, source=SOURCE).single()
    return int(record["count"]) if record else 0


def verify_demo_kg(driver):
    with driver.session() as session:
        return {
            "regions": _count(
                session,
                "MATCH (n:Region) WHERE n.source = $source RETURN count(n) AS count",
            ),
            "anchor_mappings": _count(
                session,
                """MATCH (:Mineral)-[r:LIES_IN]->(:Region)
                   WHERE r.source = $source RETURN count(r) AS count""",
            ),
            "relationships": _count(
                session,
                "MATCH ()-[r]->() WHERE r.source = $source RETURN count(r) AS count",
            ),
            "mock_nodes": _count(
                session,
                """MATCH (n) WHERE n.source = $source AND n.isMock = true
                   RETURN count(n) AS count""",
            ),
            "source": SOURCE,
        }


def _remove_demo(tx):
    rel_result = tx.run(
        """MATCH ()-[r]->() WHERE r.source = $source
           WITH collect(r) AS relationships, count(r) AS count
           FOREACH (relationship IN relationships | DELETE relationship)
           RETURN count""",
        source=SOURCE,
    ).single()
    node_result = tx.run(
        """MATCH (n) WHERE n.source = $source AND n.isMock = true
             AND NOT (n)--()
           WITH collect(n) AS nodes, count(n) AS count
           FOREACH (node IN nodes | DELETE node)
           RETURN count""",
        source=SOURCE,
    ).single()
    return {
        "relationships": int(rel_result["count"]) if rel_result else 0,
        "nodes": int(node_result["count"]) if node_result else 0,
        "source": SOURCE,
    }


def remove_demo_kg(driver):
    with driver.session() as session:
        return session.execute_write(_remove_demo)


def main():
    parser = argparse.ArgumentParser(description="Manage spatial demo KG data")
    parser.add_argument(
        "--action",
        choices=("import", "verify", "remove"),
        required=True,
    )
    args = parser.parse_args()

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from config import NEO4J_CONFIG
    from neo4j import GraphDatabase

    driver = GraphDatabase.driver(
        NEO4J_CONFIG["uri"],
        auth=(NEO4J_CONFIG["user"], NEO4J_CONFIG["password"]),
    )
    try:
        if args.action == "import":
            result = import_demo_kg(driver)
        elif args.action == "verify":
            result = verify_demo_kg(driver)
        else:
            result = remove_demo_kg(driver)
        print(result)
    finally:
        driver.close()


if __name__ == "__main__":
    main()
