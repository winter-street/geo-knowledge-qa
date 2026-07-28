from pathlib import Path
import importlib.util
import unittest

from PIL import Image, ImageStat


SOURCE_DIR = Path(__file__).resolve().parent
BUILDER_PATH = SOURCE_DIR / "build_assets.py"
ROOT = SOURCE_DIR.parent


class AssetBuilderBootstrapTests(unittest.TestCase):
    def test_asset_builder_exists(self) -> None:
        self.assertTrue(BUILDER_PATH.exists(), "build_assets.py must exist")

    def test_asset_builder_public_api_exists(self) -> None:
        spec = importlib.util.spec_from_file_location("portfolio_assets", BUILDER_PATH)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        required = (
            "load_fonts",
            "fit_text",
            "draw_cover_background",
            "draw_cover",
            "draw_architecture",
            "draw_offline_pipeline",
            "draw_online_pipeline",
            "draw_product_mock",
            "draw_contribution_matrix",
            "main",
        )
        missing = [name for name in required if not callable(getattr(module, name, None))]
        self.assertEqual(missing, [], f"missing asset builder callables: {missing}")

    def test_main_builds_cover_and_five_nonblank_technical_assets(self) -> None:
        spec = importlib.util.spec_from_file_location("portfolio_assets_build", BUILDER_PATH)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        self.assertEqual(module.main(), 0)

        expected = {
            ROOT / "assets" / "cover-background.png": (2048, 1152),
            ROOT / "地质知识图谱与RAG项目封面.png": (1600, 900),
            ROOT / "assets" / "architecture.png": (2200, 1240),
            ROOT / "assets" / "offline-pipeline.png": (2200, 1240),
            ROOT / "assets" / "online-pipeline.png": (2200, 1240),
            ROOT / "assets" / "product-mock.png": (2200, 1240),
            ROOT / "assets" / "contribution-matrix.png": (2200, 1240),
        }
        for path, size in expected.items():
            self.assertTrue(path.exists(), f"missing generated image: {path.name}")
            with Image.open(path) as image:
                self.assertEqual(image.size, size, path.name)
                variance = sum(ImageStat.Stat(image.convert("RGB")).var)
                self.assertGreater(variance, 10.0, f"generated image is visually blank: {path.name}")
        self.assertLess((ROOT / "地质知识图谱与RAG项目封面.png").stat().st_size, 4 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
