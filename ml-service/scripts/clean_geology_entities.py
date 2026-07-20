"""Preview or quarantine high-confidence invalid geology entities in Neo4j."""

import argparse
from collections import Counter
import json
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)
sys.path.insert(0, os.path.dirname(__file__))

from config import NEO4J_CONFIG, OUTPUT_DIR  # noqa: E402
from entity_quality import ENTITY_TYPES, validate_entity  # noqa: E402
from neo4j import GraphDatabase  # noqa: E402


REPORT_PATH = os.path.join(OUTPUT_DIR, "entity_cleaning_report.json")

AUTO_REJECT_REASONS = {
    "unsupported_type", "invalid_length", "contains_whitespace",
    "contains_punctuation", "contains_digit", "noise_phrase",
    "sentence_fragment", "repeated_suffix", "latin_fragment",
    "insufficient_chinese", "type_mismatch",
}


def quarantine_entities(tx, rejected: list[dict]) -> int:
    result = tx.run(
        """
        UNWIND $rows AS row
        MATCH (n) WHERE elementId(n) = row.entityId
        SET n:RejectedEntity,
            n.qualityStatus = 'rejected',
            n.rejectionReason = row.reason,
            n.originalLabels = row.labels
        REMOVE n:Mineral, n:Rock, n:Structure, n:TimePeriod, n:DepositType, n:Region
        RETURN count(n) AS count
        """,
        rows=rejected,
    ).single()
    return result["count"] if result else 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="quarantine rejected nodes; without this flag only write a report",
    )
    args = parser.parse_args()

    driver = GraphDatabase.driver(
        NEO4J_CONFIG["uri"],
        auth=(NEO4J_CONFIG["user"], NEO4J_CONFIG["password"]),
    )
    try:
        with driver.session() as session:
            rows = session.run(
                """
                MATCH (n)
                WHERE any(label IN labels(n) WHERE label IN $labels)
                  AND NOT n:RejectedEntity
                OPTIONAL MATCH (n)-[r]-()
                RETURN elementId(n) AS entityId, n.name AS name,
                       labels(n) AS labels, count(DISTINCT r) AS relationCount
                ORDER BY relationCount DESC
                """,
                labels=sorted(ENTITY_TYPES),
            )

            accepted = 0
            auto_rejected = []
            manual_review = []
            for row in rows:
                labels = [label for label in row["labels"] if label in ENTITY_TYPES]
                entity_type = labels[0] if labels else ""
                validation = validate_entity(row["name"], entity_type)
                if validation.valid:
                    accepted += 1
                    continue
                flagged = {
                    "entityId": row["entityId"],
                    "name": validation.name,
                    "type": entity_type,
                    "labels": labels,
                    "relationCount": row["relationCount"],
                    "reason": validation.reason,
                }
                if validation.reason in AUTO_REJECT_REASONS:
                    auto_rejected.append(flagged)
                else:
                    manual_review.append(flagged)

            report = {
                "accepted": accepted,
                "autoRejected": len(auto_rejected),
                "manualReview": len(manual_review),
                "reasons": dict(Counter(
                    row["reason"] for row in auto_rejected + manual_review
                )),
                "autoRejectedEntities": auto_rejected,
                "manualReviewEntities": manual_review,
            }
            os.makedirs(OUTPUT_DIR, exist_ok=True)
            with open(REPORT_PATH, "w", encoding="utf-8") as file:
                json.dump(report, file, ensure_ascii=False, indent=2)

            print(f"Accepted: {accepted}")
            print(f"Auto-quarantine candidates: {len(auto_rejected)}")
            print(f"Manual review candidates: {len(manual_review)}")
            print(f"Reasons: {report['reasons']}")
            print(f"Report: {REPORT_PATH}")
            for row in auto_rejected[:20]:
                print(
                    f"  [{row['type']}] {row['name']!r} - {row['reason']} "
                    f"({row['relationCount']} relations)"
                )

            if not args.apply:
                print("Preview only; review the report and run again with --apply.")
                return

            changed = session.execute_write(quarantine_entities, auto_rejected)
            print(f"Quarantined: {changed}")
    finally:
        driver.close()


if __name__ == "__main__":
    main()
