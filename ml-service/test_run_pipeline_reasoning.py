import importlib.util
from pathlib import Path
from unittest import TestCase
from unittest.mock import Mock


class PipelineReasoningWritebackTest(TestCase):
    def test_passes_relations_and_classifications(self):
        path = Path(__file__).parent / "scripts" / "run_pipeline.py"
        spec = importlib.util.spec_from_file_location("run_pipeline", path)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        writer = Mock()
        stats = {
            "relations": [{"from": "A"}],
            "classifications": {"RockHostedMineral": ["A"]},
        }

        module.write_reasoning_results(writer, stats)

        writer.assert_called_once_with(
            stats["relations"],
            stats["classifications"],
        )
