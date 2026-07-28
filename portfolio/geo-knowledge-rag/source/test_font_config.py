from pathlib import Path
import importlib.util
import tempfile
import unittest


SOURCE_DIR = Path(__file__).resolve().parent
FONT_CONFIG_PATH = SOURCE_DIR / "font_config.py"


class FontConfigBootstrapTests(unittest.TestCase):
    def test_font_config_module_exists(self) -> None:
        self.assertTrue(FONT_CONFIG_PATH.exists(), "font_config.py must exist")

    def test_resolves_explicit_local_font_overrides(self) -> None:
        spec = importlib.util.spec_from_file_location("portfolio_fonts", FONT_CONFIG_PATH)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            paths = {
                "regular": root / "regular.ttf",
                "bold": root / "bold.ttf",
                "serif": root / "serif.ttf",
                "latin": root / "latin.ttf",
            }
            for path in paths.values():
                path.write_bytes(b"font-test")
            environment = {
                "PORTFOLIO_FONT_REGULAR": str(paths["regular"]),
                "PORTFOLIO_FONT_BOLD": str(paths["bold"]),
                "PORTFOLIO_FONT_SERIF": str(paths["serif"]),
                "PORTFOLIO_FONT_LATIN": str(paths["latin"]),
            }
            self.assertEqual(module.resolve_fonts(environment), paths)

    def test_default_font_resolution_finds_four_existing_fonts(self) -> None:
        spec = importlib.util.spec_from_file_location("portfolio_fonts_default", FONT_CONFIG_PATH)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        fonts = module.resolve_fonts()
        self.assertEqual(set(fonts), {"regular", "bold", "serif", "latin"})
        self.assertTrue(all(path.exists() for path in fonts.values()))


if __name__ == "__main__":
    unittest.main()
