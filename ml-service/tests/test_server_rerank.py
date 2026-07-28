import importlib
import os
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest.mock import patch


ML_SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_SERVICE_DIR))

from reranker import BGEReranker


def load_server():
    output_dir = tempfile.mkdtemp()
    config = types.ModuleType("config")
    config.SQLITE_DB_PATH = os.path.join(output_dir, "test.db")
    config.TFIDF_MODEL_PATH = os.path.join(output_dir, "tfidf.pkl")
    config.NEO4J_CONFIG = {
        "uri": "bolt://127.0.0.1:7687",
        "user": "neo4j",
        "password": "test-placeholder",
    }
    config.OUTPUT_DIR = output_dir
    config.RETRIEVAL_MODE = "tfidf"
    sys.modules["config"] = config
    sys.modules.pop("server", None)
    return importlib.import_module("server")


server = load_server()


def valid_candidates(count=2):
    return [
        {"id": index + 1, "text": f"chunk {index + 1}", "score": 0.8 - index / 10}
        for index in range(count)
    ]


class RerankApiTests(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()

    def test_returns_reranked_chunks_and_status(self):
        rerank_result = {
            "results": [{"id": 2, "text": "chunk 2", "rerank_score": 0.9}],
            "status": "applied",
            "mode": "bge-reranker-base",
            "reason": None,
            "detail": None,
            "candidate_count": 2,
        }
        with patch.object(server.reranker, "rerank", return_value=rerank_result) as rerank:
            response = self.client.post("/rerank", json={
                "question": "copper deposit",
                "candidates": valid_candidates(),
                "top_k": 1,
            })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["chunks"][0]["id"], 2)
        self.assertEqual(response.get_json()["rerank"]["status"], "applied")
        rerank.assert_called_once_with("copper deposit", valid_candidates(), top_k=1)

    def test_rejects_empty_question(self):
        response = self.client.post("/rerank", json={
            "question": "  ",
            "candidates": valid_candidates(),
        })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["code"], "INVALID_RERANK_REQUEST")

    def test_rejects_more_than_twenty_candidates(self):
        response = self.client.post("/rerank", json={
            "question": "copper deposit",
            "candidates": valid_candidates(21),
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("at most 20", response.get_json()["error"])

    def test_rejects_empty_candidates(self):
        response = self.client.post("/rerank", json={
            "question": "copper deposit",
            "candidates": [],
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("at least one", response.get_json()["error"])

    def test_rejects_candidate_without_nonempty_text(self):
        response = self.client.post("/rerank", json={
            "question": "copper deposit",
            "candidates": [{"id": 1, "text": " "}],
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("non-empty text", response.get_json()["error"])

    def test_accepts_top_k_twenty_for_post_rerank_diversification(self):
        rerank_result = {
            "results": valid_candidates(20),
            "status": "applied",
            "mode": "bge-reranker-base",
            "reason": None,
            "detail": None,
            "candidate_count": 20,
        }
        with patch.object(server.reranker, "rerank", return_value=rerank_result) as rerank:
            response = self.client.post("/rerank", json={
                "question": "copper deposit",
                "candidates": valid_candidates(20),
                "top_k": 20,
            })

        self.assertEqual(response.status_code, 200)
        rerank.assert_called_once_with("copper deposit", valid_candidates(20), top_k=20)

    def test_rejects_top_k_above_twenty(self):
        response = self.client.post("/rerank", json={
            "question": "copper deposit",
            "candidates": valid_candidates(),
            "top_k": 21,
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("between 1 and 20", response.get_json()["error"])

    def test_timeout_followup_reports_busy_without_starting_another_worker(self):
        release = threading.Event()
        finished = threading.Event()
        predict_calls = 0

        class BlockingModel:
            def predict(self, _pairs):
                nonlocal predict_calls
                predict_calls += 1
                try:
                    release.wait(timeout=1)
                    return [0.5] * 2
                finally:
                    finished.set()

        isolated_reranker = BGEReranker(
            enabled=True,
            model_factory=lambda _name: BlockingModel(),
            inference_timeout_seconds=0.01,
        )
        try:
            with patch.object(server, "reranker", isolated_reranker):
                first = self.client.post("/rerank", json={
                    "question": "copper deposit",
                    "candidates": valid_candidates(),
                })
                second = self.client.post("/rerank", json={
                    "question": "copper deposit",
                    "candidates": valid_candidates(),
                })

            self.assertEqual(first.get_json()["rerank"]["reason"], "inference_timeout")
            self.assertEqual(second.get_json()["rerank"]["reason"], "inference_busy")
            self.assertEqual(predict_calls, 1)
        finally:
            release.set()
            self.assertTrue(finished.wait(timeout=1))


if __name__ == "__main__":
    unittest.main(verbosity=2)
