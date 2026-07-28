import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).parents[2] / "scripts" / "generate-data-manifest.py"


def load_manifest_module():
    spec = importlib.util.spec_from_file_location("generate_data_manifest", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class GenerateDataManifestTests(unittest.TestCase):
    def test_manifest_contains_only_aggregate_metadata_and_hashes(self):
        module = load_manifest_module()

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            database_path = temp_path / "snapshot.db"
            ontology_path = temp_path / "ontology.owl"
            connection = sqlite3.connect(database_path)
            connection.executescript(
                """
                CREATE TABLE documents (id INTEGER PRIMARY KEY, title TEXT);
                CREATE TABLE chunks (id INTEGER PRIMARY KEY, content TEXT, vector BLOB);
                INSERT INTO documents (title) VALUES ('PRIVATE DOCUMENT TITLE');
                INSERT INTO chunks (content, vector) VALUES ('PRIVATE CHUNK TEXT', X'000000000000000000000000');
                """
            )
            connection.close()
            ontology_path.write_text(
                """<?xml version=\"1.0\"?>
                <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\"
                         xmlns:owl=\"http://www.w3.org/2002/07/owl#\">
                  <owl:NamedIndividual rdf:about=\"urn:synthetic:one\" />
                  <owl:NamedIndividual rdf:about=\"urn:synthetic:two\" />
                </rdf:RDF>""",
                encoding="utf-8",
            )

            manifest = module.build_manifest(database_path, ontology_path, generated_at="2026-07-27T00:00:00Z")

        self.assertEqual(
            set(manifest),
            {
                "document_count",
                "chunk_count",
                "vector_dimension",
                "ontology_instance_count",
                "generated_at",
                "version",
                "hashes",
            },
        )
        self.assertEqual(manifest["document_count"], 1)
        self.assertEqual(manifest["chunk_count"], 1)
        self.assertEqual(manifest["vector_dimension"], 3)
        self.assertEqual(manifest["ontology_instance_count"], 2)
        self.assertEqual(manifest["generated_at"], "2026-07-27T00:00:00Z")
        self.assertEqual(manifest["version"], 1)
        self.assertEqual(set(manifest["hashes"]), {"database", "ontology"})

        serialized = json.dumps(manifest, ensure_ascii=False)
        self.assertNotIn("PRIVATE DOCUMENT TITLE", serialized)
        self.assertNotIn("PRIVATE CHUNK TEXT", serialized)


if __name__ == "__main__":
    unittest.main()
