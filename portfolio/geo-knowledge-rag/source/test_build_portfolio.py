from pathlib import Path
import hashlib
import importlib.util
import time
import unittest

from pypdf import PdfReader


SOURCE_DIR = Path(__file__).resolve().parent
BUILDER_PATH = SOURCE_DIR / "build_portfolio.py"
PDF_PATH = SOURCE_DIR.parent / "地质知识图谱与RAG项目作品集.pdf"


class PortfolioBuilderBootstrapTests(unittest.TestCase):
    def test_portfolio_builder_exists(self) -> None:
        self.assertTrue(BUILDER_PATH.exists(), "build_portfolio.py must exist")

    def test_portfolio_builder_public_api_exists(self) -> None:
        spec = importlib.util.spec_from_file_location("portfolio_pdf", BUILDER_PATH)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        required = (
            "register_fonts",
            "draw_header",
            "draw_footer",
            "draw_wrapped_text",
            "draw_figure",
            "draw_evidence_list",
            "build_pdf",
            "main",
        )
        missing = [name for name in required if not callable(getattr(module, name, None))]
        self.assertEqual(missing, [], f"missing PDF builder callables: {missing}")

    def test_main_builds_ten_page_pdf_with_text_metadata_and_links(self) -> None:
        spec = importlib.util.spec_from_file_location("portfolio_pdf_build", BUILDER_PATH)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        self.assertEqual(module.main(), 0)
        self.assertTrue(PDF_PATH.exists(), "portfolio PDF must be created")
        self.assertLess(PDF_PATH.stat().st_size, 20 * 1024 * 1024)

        reader = PdfReader(str(PDF_PATH))
        self.assertEqual(len(reader.pages), 10)
        self.assertIn("地质知识图谱", reader.metadata.title)
        for page_number, pdf_page in enumerate(reader.pages[1:], start=2):
            extracted = (pdf_page.extract_text() or "").strip()
            self.assertGreater(len(extracted), 20, f"page {page_number} lacks extractable text")

        urls: set[str] = set()
        for annotation_ref in reader.pages[9].get("/Annots", []):
            annotation = annotation_ref.get_object()
            action = annotation.get("/A")
            if action and action.get("/URI"):
                urls.add(str(action["/URI"]))
        self.assertTrue(
            {
                "https://github.com/winter-street/geo-knowledge-qa",
                "https://github.com/winter-street",
            }.issubset(urls)
        )
        reader.close()

    def test_repeated_builds_are_byte_for_byte_reproducible(self) -> None:
        spec = importlib.util.spec_from_file_location("portfolio_pdf_reproducible", BUILDER_PATH)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        module.main()
        first_hash = hashlib.sha256(PDF_PATH.read_bytes()).hexdigest()
        time.sleep(1.1)
        module.main()
        second_hash = hashlib.sha256(PDF_PATH.read_bytes()).hexdigest()
        self.assertEqual(first_hash, second_hash)


if __name__ == "__main__":
    unittest.main()
