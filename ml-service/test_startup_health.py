"""Regression tests for Flask startup health validation."""

import unittest

from startup_health import is_current_retrieval_health


class StartupHealthTests(unittest.TestCase):
    def test_rejects_legacy_status_only_health_response(self):
        self.assertFalse(is_current_retrieval_health({"status": "ok"}))

    def test_accepts_health_response_with_bge_and_tfidf_capabilities(self):
        self.assertTrue(is_current_retrieval_health({
            "status": "ok",
            "retrieval": {
                "bge": {"available": True, "reason": None},
                "tfidf": {"available": True, "reason": None},
            },
        }))


if __name__ == "__main__":
    unittest.main()
