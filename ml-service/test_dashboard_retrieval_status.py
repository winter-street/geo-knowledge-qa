"""Regression guard for the dashboard's retrieval capability display."""

from pathlib import Path
import unittest


class DashboardRetrievalStatusTests(unittest.TestCase):
    def test_dashboard_reads_granular_retrieval_capabilities(self):
        html = (Path(__file__).parent / "dashboard.html").read_text(encoding="utf-8")
        self.assertIn("retrieval.bge", html)
        self.assertIn("retrieval.tfidf", html)
        self.assertIn("健康接口版本过旧", html)


if __name__ == "__main__":
    unittest.main()
