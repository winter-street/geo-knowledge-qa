import json
import sys
import tempfile
import unittest
from pathlib import Path


DEMO_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEMO_DIR))

from generate_synthetic_demo import generate


class SyntheticDemoGeneratorTests(unittest.TestCase):
    def test_generates_deterministic_privacy_safe_demo(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            first_manifest = generate(Path(first))
            second_manifest = generate(Path(second))

            self.assertEqual(first_manifest, second_manifest)
            self.assertEqual(first_manifest["synthetic"], True)
            self.assertEqual(first_manifest["document_count"], 6)
            self.assertEqual(first_manifest["chunk_count"], 6)
            self.assertEqual(len(list((Path(first) / "documents").glob("*.md"))), 6)

            graph = json.loads((Path(first) / "graph.json").read_text(encoding="utf-8"))
            spatial = json.loads((Path(first) / "spatial.json").read_text(encoding="utf-8"))
            self.assertTrue(graph["synthetic"] and graph["isMock"])
            self.assertTrue(all(item["synthetic"] and item["isMock"] for item in graph["nodes"]))
            self.assertTrue(all(item["synthetic"] and item["isMock"] for item in graph["edges"]))
            self.assertTrue(spatial["synthetic"] and spatial["isMock"])
            self.assertTrue(all(item["synthetic"] and item["isMock"] for item in spatial["markers"]))
            self.assertTrue(all(item["synthetic"] and item["isMock"] for item in spatial["polylines"]))

            combined = "\n".join(path.read_text(encoding="utf-8") for path in Path(first).rglob("*.*"))
            for forbidden in ["DEEPSEEK_API_KEY", "AMAP_KEY", "Bearer ", "Neo4j password"]:
                self.assertNotIn(forbidden, combined)


if __name__ == "__main__":
    unittest.main(verbosity=2)
