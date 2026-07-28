#!/usr/bin/env python3
"""Generate a privacy-safe aggregate manifest for a local data snapshot."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import xml.etree.ElementTree as element_tree
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MANIFEST_VERSION = 1


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def count_rows(connection: sqlite3.Connection, table: str) -> int:
    row = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
    return int(row[0]) if row else 0


def get_vector_dimension(connection: sqlite3.Connection) -> int:
    row = connection.execute(
        "SELECT vector FROM chunks WHERE vector IS NOT NULL LIMIT 1"
    ).fetchone()
    if not row or row[0] is None:
        return 0

    vector = bytes(row[0])
    if len(vector) % 4 != 0:
        raise ValueError("chunk vector data is not a float32 byte sequence")
    return len(vector) // 4


def count_ontology_instances(ontology_path: Path) -> int:
    root = element_tree.parse(ontology_path).getroot()
    return sum(element.tag.rsplit("}", 1)[-1] == "NamedIndividual" for element in root.iter())


def build_manifest(
    database_path: Path,
    ontology_path: Path,
    generated_at: str | None = None,
) -> dict[str, Any]:
    database_path = Path(database_path)
    ontology_path = Path(ontology_path)
    if not database_path.is_file():
        raise FileNotFoundError(f"database not found: {database_path}")
    if not ontology_path.is_file():
        raise FileNotFoundError(f"ontology not found: {ontology_path}")

    with closing(sqlite3.connect(database_path)) as connection:
        document_count = count_rows(connection, "documents")
        chunk_count = count_rows(connection, "chunks")
        vector_dimension = get_vector_dimension(connection)

    return {
        "document_count": document_count,
        "chunk_count": chunk_count,
        "vector_dimension": vector_dimension,
        "ontology_instance_count": count_ontology_instances(ontology_path),
        "generated_at": generated_at
        or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "version": MANIFEST_VERSION,
        "hashes": {
            "database": sha256_file(database_path),
            "ontology": sha256_file(ontology_path),
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--ontology", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest = build_manifest(args.database, args.ontology)
    rendered = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
