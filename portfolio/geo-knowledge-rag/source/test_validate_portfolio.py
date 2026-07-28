from pathlib import Path
import importlib.util
import tempfile
import unittest

from PIL import Image, PngImagePlugin
from pypdf import PdfReader, PdfWriter


SOURCE_DIR = Path(__file__).resolve().parent
VALIDATOR_PATH = SOURCE_DIR / "validate_portfolio.py"


def load_validator():
    spec = importlib.util.spec_from_file_location("portfolio_validator", VALIDATOR_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load validator module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ValidatorBootstrapTests(unittest.TestCase):
    def test_validator_module_exists(self) -> None:
        self.assertTrue(
            VALIDATOR_PATH.exists(),
            "validate_portfolio.py must exist before portfolio artifacts are accepted",
        )

    def test_validator_public_api_exists(self) -> None:
        module = load_validator()
        required = (
            "load_content",
            "extract_upload_description",
            "find_privacy_violations",
            "validate_content",
            "validate_images",
            "validate_pdf",
            "validate_rendered_pages",
            "build_manifest",
            "main",
        )
        missing = [name for name in required if not callable(getattr(module, name, None))]
        self.assertEqual(missing, [], f"missing validator callables: {missing}")

    def test_extracts_only_upload_description_body(self) -> None:
        module = load_validator()
        text = (
            "作品名称：示例项目\n\n"
            "项目描述：\n这是第一句。\n这是第二句。\n\n"
            "项目链接：\nhttps://github.com/winter-street/geo-knowledge-qa\n"
        )
        self.assertEqual(module.extract_upload_description(text), "这是第一句。\n这是第二句。")

    def test_detects_credential_path_coordinate_and_private_artifact_patterns(self) -> None:
        module = load_validator()
        unsafe = (
            "token=sk-1234567890abcdefghijklmnop\n"
            "password: demo-secret\n"
            "D:\\private\\report.pdf\n"
            "private host 192.168.10.24\n"
            "坐标 116.397, 39.908\n"
            "parsed_texts.json geo_knowledge.db config.py 真实文献"
        )
        violations = module.find_privacy_violations(unsafe)
        self.assertEqual(
            set(violations),
            {"credential", "windows_path", "network_address", "coordinate_pair", "private_artifact"},
        )

    def test_allows_approved_links_and_synthetic_labels(self) -> None:
        module = load_validator()
        safe = (
            "演示矿物 A、演示岩体 A、演示构造 A。"
            "https://github.com/winter-street/geo-knowledge-qa "
            "https://github.com/winter-street"
        )
        self.assertEqual(module.find_privacy_violations(safe), [])

    def test_rejects_unapproved_external_url(self) -> None:
        module = load_validator()
        self.assertEqual(
            module.find_privacy_violations("外部地址 https://example.com/demo"),
            ["external_url"],
        )

    def test_detects_lower_precision_latitude_longitude_pair(self) -> None:
        module = load_validator()
        self.assertEqual(
            module.find_privacy_violations("位置 39.90, 116.39"),
            ["coordinate_pair"],
        )

    def test_reports_unapproved_pdf_annotation_urls(self) -> None:
        module = load_validator()
        urls = {
            "https://github.com/winter-street/geo-knowledge-qa",
            "https://github.com/winter-street",
            "https://example.com/hidden",
        }
        self.assertEqual(module.find_unapproved_urls(urls), {"https://example.com/hidden"})

    def test_content_model_and_upload_copy_pass_validation(self) -> None:
        module = load_validator()
        self.assertTrue((SOURCE_DIR / "content.json").exists(), "content.json must exist")
        self.assertTrue((SOURCE_DIR.parent / "作品上传文案.txt").exists(), "upload copy must exist")
        content = module.load_content()
        self.assertEqual([page["number"] for page in content["pages"]], list(range(1, 11)))
        self.assertEqual(
            [page["slug"] for page in content["pages"]],
            [
                "positioning",
                "problem",
                "architecture",
                "offline",
                "online",
                "experience",
                "contribution",
                "challenges",
                "verification",
                "links",
            ],
        )
        self.assertEqual(module.validate_content(), [])

    def test_image_validation_reports_missing_artifacts(self) -> None:
        module = load_validator()
        with tempfile.TemporaryDirectory() as temp_dir:
            module.ROOT = Path(temp_dir)
            errors = module.validate_images()
        self.assertTrue(errors, "missing image artifacts must fail validation")
        self.assertTrue(any("封面" in error or "cover" in error for error in errors))

    def test_image_validation_scans_png_text_metadata(self) -> None:
        module = load_validator()
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            root.mkdir(exist_ok=True)
            image = Image.new("RGB", (1600, 900), "white")
            metadata = PngImagePlugin.PngInfo()
            metadata.add_text("comment", "sk-1234567890abcdefghijklmnop")
            image.save(root / "地质知识图谱与RAG项目封面.png", pnginfo=metadata)
            module.ROOT = root
            errors = module.validate_images()
        self.assertTrue(any("metadata privacy" in error for error in errors))

    def test_pdf_validation_reports_missing_document(self) -> None:
        module = load_validator()
        with tempfile.TemporaryDirectory() as temp_dir:
            module.ROOT = Path(temp_dir)
            errors = module.validate_pdf()
        self.assertTrue(errors, "a missing portfolio PDF must fail validation")
        self.assertTrue(any("PDF" in error or "pdf" in error for error in errors))

    def test_pdf_validation_rejects_non_a4_landscape_pages(self) -> None:
        module = load_validator()
        source_pdf = SOURCE_DIR.parent / "地质知识图谱与RAG项目作品集.pdf"
        reader = PdfReader(str(source_pdf))
        writer = PdfWriter()
        for pdf_page in reader.pages:
            pdf_page.mediabox.upper_right = (612, 792)
            writer.add_page(pdf_page)
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            target = root / "地质知识图谱与RAG项目作品集.pdf"
            with target.open("wb") as handle:
                writer.write(handle)
            module.ROOT = root
            errors = module.validate_pdf()
        self.assertTrue(any("A4 landscape" in error for error in errors))

    def test_rendered_validation_reports_missing_pages(self) -> None:
        module = load_validator()
        with tempfile.TemporaryDirectory() as temp_dir:
            module.ROOT = Path(temp_dir)
            errors = module.validate_rendered_pages()
        self.assertTrue(errors, "missing rendered pages must fail validation")
        self.assertTrue(any("rendered" in error or "page" in error for error in errors))

    def test_rendered_validation_rejects_wrong_150_dpi_dimensions(self) -> None:
        module = load_validator()
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            rendered = root / "rendered"
            rendered.mkdir()
            for index in range(1, 11):
                image = Image.new("RGB", (320, 200), (23, 39, 51))
                image.save(rendered / f"page-{index:02d}.png")
            module.ROOT = root
            errors = module.validate_rendered_pages()
        self.assertTrue(any("150 DPI" in error for error in errors))

    def test_collects_builder_source_for_visible_text_privacy_scan(self) -> None:
        module = load_validator()
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source"
            source.mkdir()
            (source / "build_assets.py").write_text(
                'VISIBLE_LABEL = "sk-1234567890abcdefghijklmnop"',
                encoding="utf-8",
            )
            collected = module.collect_privacy_text({}, "", root)
        self.assertIn("sk-1234567890abcdefghijklmnop", collected)

    def test_manifest_reports_upload_ready_artifact_facts(self) -> None:
        module = load_validator()
        manifest = module.build_manifest()
        self.assertEqual(manifest["cover_dimensions"], [1600, 900])
        self.assertEqual(manifest["pdf_pages"], 10)
        self.assertLess(manifest["description_characters"], 351)
        self.assertEqual(
            manifest["github"],
            "https://github.com/winter-street/geo-knowledge-qa",
        )
        self.assertEqual(len(manifest["deliverables"]), 3)


if __name__ == "__main__":
    unittest.main()
