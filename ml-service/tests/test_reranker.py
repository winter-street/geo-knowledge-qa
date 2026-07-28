import sys
import threading
import time
import unittest
from pathlib import Path


ML_SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_SERVICE_DIR))

from reranker import BGEReranker


def candidates(count=6):
    return [
        {
            "id": index + 1,
            "text": f"candidate {index + 1}",
            "score": round(1 - index / 100, 2),
        }
        for index in range(count)
    ]


class FakeCrossEncoder:
    def __init__(self, scores):
        self.scores = scores
        self.pairs = None

    def predict(self, pairs):
        self.pairs = pairs
        return self.scores[:len(pairs)]


class BGERerankerTests(unittest.TestCase):
    def test_lazily_loads_model_and_reranks_all_twenty_candidates(self):
        model = FakeCrossEncoder([float(index) for index in range(20)])
        factory_calls = []

        def model_factory(model_name):
            factory_calls.append(model_name)
            return model

        reranker = BGEReranker(enabled=True, model_factory=model_factory)
        self.assertEqual(factory_calls, [])

        outcome = reranker.rerank("copper deposit", candidates(21), top_k=20)

        self.assertEqual(factory_calls, ["BAAI/bge-reranker-base"])
        self.assertEqual(len(model.pairs), 20)
        self.assertEqual(outcome["status"], "applied")
        self.assertEqual(len(outcome["results"]), 20)
        self.assertEqual([item["id"] for item in outcome["results"][:5]], [20, 19, 18, 17, 16])
        self.assertEqual(outcome["results"][0]["rerank_score"], 19.0)
        self.assertEqual(outcome["candidate_count"], 20)

    def test_disabled_model_returns_explicit_fallback_without_loading(self):
        def unexpected_factory(_model_name):
            raise AssertionError("disabled reranker must not load a model")

        reranker = BGEReranker(enabled=False, model_factory=unexpected_factory)
        outcome = reranker.rerank("copper deposit", candidates(), top_k=5)

        self.assertEqual(outcome["status"], "fallback")
        self.assertEqual(outcome["reason"], "model_disabled")
        self.assertEqual([item["id"] for item in outcome["results"]], [1, 2, 3, 4, 5])

    def test_missing_dependency_returns_explicit_fallback(self):
        def missing_dependency(_model_name):
            raise ImportError("sentence-transformers is unavailable")

        reranker = BGEReranker(enabled=True, model_factory=missing_dependency)
        outcome = reranker.rerank("copper deposit", candidates(), top_k=5)

        self.assertEqual(outcome["status"], "fallback")
        self.assertEqual(outcome["reason"], "dependency_unavailable")
        self.assertIn("sentence-transformers", outcome["detail"])

    def test_inference_error_returns_explicit_fallback(self):
        class BrokenModel:
            def predict(self, _pairs):
                raise RuntimeError("inference failed")

        reranker = BGEReranker(enabled=True, model_factory=lambda _name: BrokenModel())
        outcome = reranker.rerank("copper deposit", candidates(), top_k=5)

        self.assertEqual(outcome["status"], "fallback")
        self.assertEqual(outcome["reason"], "model_error")
        self.assertEqual([item["id"] for item in outcome["results"]], [1, 2, 3, 4, 5])

    def test_inference_timeout_returns_explicit_fallback(self):
        release = threading.Event()
        finished = threading.Event()

        class SlowModel:
            def predict(self, _pairs):
                try:
                    release.wait(timeout=1)
                    return [0.5]
                finally:
                    finished.set()

        reranker = BGEReranker(
            enabled=True,
            model_factory=lambda _name: SlowModel(),
            inference_timeout_seconds=0.01,
        )
        try:
            started = time.monotonic()
            outcome = reranker.rerank("copper deposit", candidates(), top_k=5)

            self.assertLess(time.monotonic() - started, 0.08)
            self.assertEqual(outcome["status"], "fallback")
            self.assertEqual(outcome["reason"], "inference_timeout")
        finally:
            release.set()
            self.assertTrue(finished.wait(timeout=1))

    def test_timeout_keeps_single_inference_worker_until_it_finishes(self):
        release = threading.Event()
        started = threading.Event()
        finished = threading.Event()
        predict_calls = 0

        class BlockingModel:
            def predict(self, _pairs):
                nonlocal predict_calls
                predict_calls += 1
                started.set()
                try:
                    release.wait(timeout=1)
                    return [0.5] * 6
                finally:
                    finished.set()

        reranker = BGEReranker(
            enabled=True,
            model_factory=lambda _name: BlockingModel(),
            inference_timeout_seconds=0.01,
        )
        try:
            first = reranker.rerank("copper deposit", candidates(), top_k=5)
            self.assertTrue(started.is_set())
            repeated = [
                reranker.rerank("copper deposit", candidates(), top_k=5)
                for _ in range(4)
            ]

            self.assertEqual(first["reason"], "inference_timeout")
            self.assertEqual([item["reason"] for item in repeated], ["inference_busy"] * 4)
            self.assertEqual(predict_calls, 1)
            active_workers = [
                thread for thread in threading.enumerate()
                if thread.name == "bge-reranker-inference"
            ]
            self.assertEqual(len(active_workers), 1)
        finally:
            release.set()
            self.assertTrue(finished.wait(timeout=1))


if __name__ == "__main__":
    unittest.main(verbosity=2)
