import sys
from pathlib import Path
from unittest import TestCase


SCRIPTS_DIR = Path(__file__).parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from import_spatial_demo_kg import import_demo_kg, remove_demo_kg
from spatial_demo_kg_data import REGIONS


class RecordingResult:
    def single(self):
        return {"count": 0}


class RecordingTransaction:
    def __init__(self, calls):
        self.calls = calls

    def run(self, query, **params):
        self.calls.append((query, params))
        return RecordingResult()


class RecordingSession:
    def __init__(self):
        self.calls = []
        self.tx = RecordingTransaction(self.calls)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute_write(self, callback, *args):
        return callback(self.tx, *args)


class FakeDriver:
    def __init__(self):
        self.recording_session = RecordingSession()

    def session(self):
        return self.recording_session


class DemoKgImportTest(TestCase):
    def test_manifest_has_ten_regions_and_43_anchors(self):
        self.assertEqual(len(REGIONS), 10)
        self.assertEqual(
            sum(len(region["anchors"]) for region in REGIONS),
            43,
        )

    def test_relationship_merge_is_source_scoped(self):
        driver = FakeDriver()

        import_demo_kg(driver)

        relationship_queries = [
            query
            for query, _params in driver.recording_session.calls
            if "MERGE (a)-[r:" in query
        ]
        self.assertTrue(relationship_queries)
        self.assertTrue(
            all("{source: $source}" in query for query in relationship_queries)
        )

    def test_cleanup_targets_only_demo_source(self):
        driver = FakeDriver()

        remove_demo_kg(driver)

        self.assertTrue(driver.recording_session.calls)
        self.assertTrue(
            all(
                params.get("source") == "spatial-demo-v1"
                for _query, params in driver.recording_session.calls
            )
        )
