"""Generate a deterministic, explicitly fictional geological demo dataset."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


DEPOSITS = [
    ("Aurora", "Lumen Granite", "Meridian Fault", "Epoch Alpha", "Northfield"),
    ("Borealis", "Prism Diorite", "Horizon Fault", "Epoch Beta", "Eastfield"),
    ("Cirrus", "Echo Schist", "Vector Fault", "Epoch Gamma", "Southfield"),
    ("Dawn", "Nova Gabbro", "Zenith Fault", "Epoch Delta", "Westfield"),
    ("Ember", "Halo Quartzite", "Parallax Fault", "Epoch Epsilon", "Centralfield"),
    ("Frost", "Orbit Rhyolite", "Solstice Fault", "Epoch Zeta", "Highfield"),
]


def _write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def generate(output_dir: Path) -> dict:
    output_dir = output_dir.resolve()
    documents_dir = output_dir / "documents"
    documents_dir.mkdir(parents=True, exist_ok=True)
    documents, nodes, edges, paths, markers, polylines = [], [], [], [], [], []

    for index, (deposit, rock, fault, epoch, region) in enumerate(DEPOSITS, start=1):
        suffix = f"{index:02d}"
        deposit_name = f"Synthetic {deposit} Deposit {index}"
        rock_name = f"Synthetic {rock} {index}"
        fault_name = f"Synthetic {fault} {index}"
        epoch_name = f"Synthetic {epoch} {index}"
        region_name = f"Synthetic {region} Region {index}"
        content = (
            f"# {deposit_name}\n\n"
            "Synthetic demonstration document. It does not describe a real survey site.\n\n"
            f"{deposit_name} is hosted in {rock_name}. It is controlled by {fault_name}, "
            f"formed in {epoch_name}, and lies in {region_name}. "
            "The evidence is fictional and isMock=true.\n"
        )
        document_path = documents_dir / f"{suffix}-synthetic-{deposit.lower()}-deposit.md"
        document_path.write_text(content, encoding="utf-8")
        documents.append({
            "id": f"SYN-DOC-{suffix}", "chunkId": 9000 + index,
            "title": f"Synthetic Geological Note {suffix}", "page": 1,
            "docType": "synthetic", "content": content, "synthetic": True, "isMock": True,
        })

        node_specs = [
            (f"SYN-MINERAL-{suffix}", deposit_name, "Mineral", [f"Synthetic Deposit {index}"]),
            (f"SYN-ROCK-{suffix}", rock_name, "Rock", []),
            (f"SYN-STRUCTURE-{suffix}", fault_name, "Structure", []),
            (f"SYN-TIME-{suffix}", epoch_name, "TimePeriod", []),
            (f"SYN-REGION-{suffix}", region_name, "Region", []),
        ]
        for node_id, name, node_type, aliases in node_specs:
            nodes.append({
                "id": node_id, "label": name, "name": name, "type": node_type,
                "aliases": aliases, "properties": {"sourceDocumentId": f"SYN-DOC-{suffix}"},
                "synthetic": True, "isMock": True,
            })

        relation_specs = [
            ("HOSTED_IN", "hosted in", f"SYN-ROCK-{suffix}", rock_name),
            ("CONTROLLED_BY", "controlled by", f"SYN-STRUCTURE-{suffix}", fault_name),
            ("FORMED_IN", "formed in", f"SYN-TIME-{suffix}", epoch_name),
            ("LIES_IN", "lies in", f"SYN-REGION-{suffix}", region_name),
        ]
        for relation_type, label, target_id, target_name in relation_specs:
            edges.append({
                "id": f"SYN-EDGE-{suffix}-{relation_type}", "source": f"SYN-MINERAL-{suffix}",
                "target": target_id, "type": relation_type, "label": label,
                "synthetic": True, "isMock": True,
            })
            paths.append({
                "from": deposit_name, "relation": label, "relationType": relation_type,
                "to": target_name, "source": "synthetic-demo-v1",
                "synthetic": True, "isMock": True,
            })

        lng, lat = round(10 + index * 0.173, 3), round(20 + index * 0.137, 3)
        markers.append({
            "id": f"SYN-MINERAL-{suffix}", "name": deposit_name, "type": "Mineral",
            "lng": lng, "lat": lat, "region": region_name,
            "mineralKind": "Synthetic copper occurrence", "era": epoch_name,
            "isMock": True, "synthetic": True,
            "evidence": "Fictional coordinate for public demonstration only.",
        })
        polylines.append({
            "id": f"SYN-STRUCTURE-{suffix}", "type": "fault", "label": fault_name,
            "region": region_name,
            "path": [[lng - 0.08, lat - 0.05], [lng + 0.08, lat + 0.05]],
            "isMock": True, "synthetic": True,
            "evidence": "Fictional geometry for public demonstration only.",
        })

    _write_json(output_dir / "documents.json", {"synthetic": True, "isMock": True, "documents": documents})
    _write_json(output_dir / "graph.json", {
        "synthetic": True, "isMock": True, "nodes": nodes, "edges": edges, "paths": paths,
    })
    _write_json(output_dir / "spatial.json", {
        "synthetic": True, "isMock": True, "markers": markers, "polylines": polylines,
    })
    artifact_names = ["documents.json", "graph.json", "spatial.json"]
    artifact_names.extend(f"documents/{item.name}" for item in sorted(documents_dir.glob("*.md")))
    manifest = {
        "schema_version": "1.0", "synthetic": True, "isMock": True,
        "document_count": len(documents), "chunk_count": len(documents),
        "graph_node_count": len(nodes), "graph_edge_count": len(edges),
        "spatial_feature_count": len(markers) + len(polylines),
        "sha256": {name: _sha256(output_dir / name) for name in artifact_names},
    }
    _write_json(output_dir / "manifest.json", manifest)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "generated")
    args = parser.parse_args()
    print(json.dumps(generate(args.output), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
