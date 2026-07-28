import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class PublicDemoContractTests(unittest.TestCase):
    def test_root_commands_start_and_stop_synthetic_demo(self):
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertIn("start-synthetic-demo.ps1", package["scripts"]["demo"])
        self.assertIn("stop-synthetic-demo.ps1", package["scripts"]["demo:stop"])

    def test_dify_workflow_calls_backend_without_embedded_credentials(self):
        workflow = (ROOT / "demo" / "dify" / "geology-agent-workflow.yml").read_text(encoding="utf-8")
        self.assertIn("mode: workflow", workflow)
        self.assertIn("/api/qa/ask", workflow)
        self.assertIn("backend_token", workflow)
        self.assertNotRegex(workflow, r"Bearer\s+[A-Za-z0-9._~-]{20,}")
        self.assertNotRegex(workflow, r"sk-[A-Za-z0-9_-]{16,}")

    def test_readme_documents_public_demo_and_evaluation_boundaries(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        for heading in [
            "Architecture",
            "Tool execution sequence",
            "Multi-turn examples",
            "Evaluation",
            "Privacy",
            "Limitations",
            "Troubleshooting",
            "Resume guidance",
        ]:
            self.assertIn(heading, readme)
        self.assertIn("professional geological documents", readme)
        self.assertIn("reproducible evaluation framework", readme)
        self.assertIn("human blind review", readme)


if __name__ == "__main__":
    unittest.main(verbosity=2)
