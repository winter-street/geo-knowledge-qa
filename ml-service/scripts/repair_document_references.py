"""Rebuild Document->Entity REFERENCES from the actual SQLite document text."""

import argparse
import os
from pathlib import Path
import sqlite3
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from config import NEO4J_CONFIG, SQLITE_DB_PATH  # noqa: E402
from neo4j import GraphDatabase  # noqa: E402


ENTITY_LABELS = {
    "Mineral", "Rock", "Structure", "TimePeriod", "DepositType", "Region"
}


def load_document_texts() -> dict[str, str]:
    database_uri = f"{Path(SQLITE_DB_PATH).resolve().as_uri()}?mode=ro&immutable=1"
    with sqlite3.connect(database_uri, uri=True) as conn:
        documents = conn.execute("SELECT id, title FROM documents ORDER BY id").fetchall()
        result = {}
        for doc_id, title in documents:
            chunks = conn.execute(
                "SELECT text FROM chunks WHERE doc_id = ? ORDER BY id", (doc_id,)
            ).fetchall()
            result[title] = "\n".join(text or "" for (text,) in chunks)
    return result


def rebuild_references(tx, pairs: list[dict[str, str]]) -> tuple[int, int]:
    old_count = tx.run(
        "MATCH (:Document)-[r:REFERENCES]->() RETURN count(r) AS count"
    ).single()["count"]
    tx.run("MATCH (:Document)-[r:REFERENCES]->() DELETE r").consume()
    for start in range(0, len(pairs), 1000):
        tx.run(
            """
            UNWIND $pairs AS pair
            MATCH (d:Document {title: pair.title})
            MATCH (e)
            WHERE elementId(e) = pair.entityId
            MERGE (d)-[:REFERENCES {display: '引用'}]->(e)
            """,
            pairs=pairs[start:start + 1000],
            labels=sorted(ENTITY_LABELS),
        ).consume()
    new_count = tx.run(
        "MATCH (:Document)-[r:REFERENCES]->() RETURN count(r) AS count"
    ).single()["count"]
    return old_count, new_count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="replace existing REFERENCES; without this flag the script only previews",
    )
    args = parser.parse_args()

    document_texts = load_document_texts()
    driver = GraphDatabase.driver(
        NEO4J_CONFIG["uri"],
        auth=(NEO4J_CONFIG["user"], NEO4J_CONFIG["password"]),
    )

    try:
        with driver.session() as session:
            entity_rows = session.run(
                """
                MATCH (e)
                WHERE e.name IS NOT NULL
                  AND any(label IN labels(e) WHERE label IN $labels)
                RETURN elementId(e) AS entityId, e.name AS name
                """,
                labels=sorted(ENTITY_LABELS),
            )
            entities = [
                {"entityId": row["entityId"], "name": row["name"]}
                for row in entity_rows if len(row["name"]) >= 2
            ]

            pairs = [
                {"title": title, "entityId": entity["entityId"]}
                for title, text in document_texts.items()
                for entity in entities
                if entity["name"] in text
            ]
            old_count = session.run(
                "MATCH (:Document)-[r:REFERENCES]->() RETURN count(r) AS count"
            ).single()["count"]
            print(f"Existing REFERENCES: {old_count}")
            print(f"Candidate REFERENCES: {len(pairs)}")
            print(f"Documents scanned: {len(document_texts)}, entities scanned: {len(entities)}")
            if not args.apply:
                print("Preview only; run again with --apply to commit the repair.")
                return

            old_count, new_count = session.execute_write(rebuild_references, pairs)
    finally:
        driver.close()

    print(f"REFERENCES repaired: {old_count} -> {new_count}")


if __name__ == "__main__":
    main()
