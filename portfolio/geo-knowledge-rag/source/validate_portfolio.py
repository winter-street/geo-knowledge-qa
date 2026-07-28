"""Validate the recruitment portfolio and print its delivery manifest."""

import argparse
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
CONTENT_PATH = ROOT / "source" / "content.json"
COPY_PATH = ROOT / "作品上传文案.txt"
APPROVED_URLS = {
    "https://github.com/winter-street/geo-knowledge-qa",
    "https://github.com/winter-street",
}


def load_content() -> dict:
    return json.loads(CONTENT_PATH.read_text(encoding="utf-8"))


def extract_upload_description(text: str) -> str:
    match = re.search(r"项目描述：\s*(.*?)\s*项目链接：", text, re.DOTALL)
    return match.group(1).strip() if match else ""


def find_privacy_violations(text: str) -> list[str]:
    rules = {
        "credential": (
            r"\bsk-[A-Za-z0-9_-]{16,}\b",
            r"(?i)\b(?:api[_ -]?key|password|token)\b\s*[:=]\s*[^\s,;]+",
        ),
        "windows_path": (r"(?i)\b[A-Z]:\\[^\s]+",),
        "network_address": (
            r"(?<!\d)(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?!\d)",
        ),
        "coordinate_pair": (
            r"(?<![\d.])-?\d{1,3}\.\d{2,}\s*[,，]\s*-?\d{1,3}\.\d{2,}(?![\d.])",
        ),
        "private_artifact": (
            r"(?i)parsed_texts\.json|geo_knowledge\.db|(?<!example\.)\bconfig\.py\b|真实文献",
        ),
    }
    violations = [
        name
        for name, patterns in rules.items()
        if any(re.search(pattern, text) for pattern in patterns)
    ]
    urls = {url.rstrip(".,;，。；") for url in re.findall(r"https?://[^\s\"')\]]+", text)}
    if urls - APPROVED_URLS:
        violations.append("external_url")
    return violations


def find_unapproved_urls(urls: set[str]) -> set[str]:
    return urls - APPROVED_URLS


def collect_privacy_text(content: dict, upload_text: str, root: Path = ROOT) -> str:
    parts = [json.dumps(content, ensure_ascii=False), upload_text]
    for filename in ("build_assets.py", "build_portfolio.py", "font_config.py"):
        path = root / "source" / filename
        if path.exists():
            parts.append(path.read_text(encoding="utf-8"))
    return "\n".join(parts)


def validate_content() -> list[str]:
    errors: list[str] = []
    if not CONTENT_PATH.exists():
        errors.append("missing source/content.json")
        return errors
    if not COPY_PATH.exists():
        errors.append("missing 作品上传文案.txt")
        return errors

    try:
        content = load_content()
    except (OSError, json.JSONDecodeError) as exc:
        return [f"invalid content.json: {exc}"]

    required_top = {"meta", "palette", "github", "privacy", "pages"}
    missing_top = sorted(required_top - set(content))
    if missing_top:
        errors.append(f"content.json missing fields: {', '.join(missing_top)}")

    pages = content.get("pages")
    if not isinstance(pages, list) or len(pages) != 10:
        errors.append("content.json must contain exactly 10 pages")
    else:
        numbers = [page.get("number") for page in pages]
        if numbers != list(range(1, 11)):
            errors.append(f"page numbers must be 1 through 10, got {numbers}")
        slugs = [page.get("slug") for page in pages]
        if len(set(slugs)) != 10:
            errors.append("page slugs must be unique")
        required_page = {"number", "slug", "title", "question", "summary", "evidence", "visual"}
        for index, page in enumerate(pages, start=1):
            missing_page = sorted(required_page - set(page))
            if missing_page:
                errors.append(f"page {index} missing fields: {', '.join(missing_page)}")
            for field in ("slug", "title", "question", "summary", "visual"):
                if not isinstance(page.get(field), str) or not page[field].strip():
                    errors.append(f"page {index} field {field} must be non-empty text")
            if not isinstance(page.get("evidence"), list) or not page["evidence"]:
                errors.append(f"page {index} evidence must be a non-empty list")

    github = content.get("github", {})
    if {github.get("repository"), github.get("profile")} != APPROVED_URLS:
        errors.append("content.json must use only the approved GitHub URLs")

    upload_text = COPY_PATH.read_text(encoding="utf-8")
    description = extract_upload_description(upload_text)
    if not description:
        errors.append("upload copy is missing the 项目描述 section")
    elif len(description) > 350:
        errors.append(f"upload description is {len(description)} characters; maximum is 350")

    combined = collect_privacy_text(content, upload_text, ROOT)
    violations = find_privacy_violations(combined)
    if violations:
        errors.append(f"privacy violations: {', '.join(violations)}")
    return errors


def validate_images() -> list[str]:
    from PIL import Image, ImageStat

    errors: list[str] = []
    expected = {
        ROOT / "assets" / "cover-background.png": (2048, 1152),
        ROOT / "地质知识图谱与RAG项目封面.png": (1600, 900),
        ROOT / "assets" / "architecture.png": (2200, 1240),
        ROOT / "assets" / "offline-pipeline.png": (2200, 1240),
        ROOT / "assets" / "online-pipeline.png": (2200, 1240),
        ROOT / "assets" / "product-mock.png": (2200, 1240),
        ROOT / "assets" / "contribution-matrix.png": (2200, 1240),
    }
    for path, expected_size in expected.items():
        if not path.exists():
            errors.append(f"missing image: {path.name}")
            continue
        try:
            with Image.open(path) as source:
                metadata_text = json.dumps(source.info, ensure_ascii=False, default=str)
                metadata_violations = find_privacy_violations(metadata_text)
                if metadata_violations:
                    errors.append(
                        f"{path.name} metadata privacy violations: {', '.join(metadata_violations)}"
                    )
                image = source.convert("RGB")
                if image.size != expected_size:
                    errors.append(f"{path.name} size is {image.size}; expected {expected_size}")
                variance = sum(ImageStat.Stat(image).var)
                if variance <= 10.0:
                    errors.append(f"{path.name} has insufficient pixel variance")
                sample = image.resize((200, 112), Image.Resampling.BILINEAR)
                colors = sample.getcolors(maxcolors=200 * 112)
                if colors:
                    dominant = max(count for count, _ in colors)
                    non_background_ratio = 1 - dominant / (200 * 112)
                    if non_background_ratio < 0.03:
                        errors.append(f"{path.name} has less than 3% non-background pixels")
        except OSError as exc:
            errors.append(f"cannot decode {path.name}: {exc}")

    cover = ROOT / "地质知识图谱与RAG项目封面.png"
    if cover.exists() and cover.stat().st_size >= 4 * 1024 * 1024:
        errors.append(f"cover is {cover.stat().st_size} bytes; limit is below 4 MB")
    return errors


def validate_pdf() -> list[str]:
    from pypdf import PdfReader

    errors: list[str] = []
    pdf_path = ROOT / "地质知识图谱与RAG项目作品集.pdf"
    if not pdf_path.exists():
        return ["missing portfolio PDF"]
    if pdf_path.stat().st_size >= 20 * 1024 * 1024:
        errors.append(f"PDF is {pdf_path.stat().st_size} bytes; limit is below 20 MB")

    try:
        reader = PdfReader(str(pdf_path))
    except Exception as exc:
        return [f"cannot open portfolio PDF: {exc}"]
    if len(reader.pages) != 10:
        errors.append(f"PDF has {len(reader.pages)} pages; expected exactly 10")

    extracted_pages: list[str] = []
    for index, pdf_page in enumerate(reader.pages, start=1):
        page_width = float(pdf_page.mediabox.width)
        page_height = float(pdf_page.mediabox.height)
        if abs(page_width - 841.89) > 1 or abs(page_height - 595.28) > 1:
            errors.append(
                f"PDF page {index} is {page_width:.2f} x {page_height:.2f} pt; expected A4 landscape"
            )
        contents = pdf_page.get_contents()
        if contents is None or not contents.get_data():
            errors.append(f"PDF page {index} has an empty content stream")
        text = (pdf_page.extract_text() or "").strip()
        extracted_pages.append(text)
        if index >= 2 and len(text) <= 20:
            errors.append(f"PDF page {index} lacks extractable text")

    urls: set[str] = set()
    if len(reader.pages) >= 10:
        for annotation_ref in reader.pages[9].get("/Annots", []):
            annotation = annotation_ref.get_object()
            action = annotation.get("/A")
            if action and action.get("/URI"):
                urls.add(str(action["/URI"]))
    if not APPROVED_URLS.issubset(urls):
        errors.append("PDF page 10 is missing one or both approved GitHub links")
    unapproved_urls = find_unapproved_urls(urls)
    if unapproved_urls:
        errors.append(f"PDF contains unapproved annotation URLs: {', '.join(sorted(unapproved_urls))}")

    violations = find_privacy_violations("\n".join(extracted_pages))
    if violations:
        errors.append(f"PDF text privacy violations: {', '.join(violations)}")
    return errors


def validate_rendered_pages() -> list[str]:
    from PIL import Image, ImageDraw, ImageStat

    errors: list[str] = []
    rendered = ROOT / "rendered"
    page_paths = [rendered / f"page-{index:02d}.png" for index in range(1, 11)]
    missing = [path.name for path in page_paths if not path.exists()]
    if missing:
        return [f"missing rendered pages: {', '.join(missing)}"]

    page_size: tuple[int, int] | None = None
    thumbnails: list[Image.Image] = []
    for index, path in enumerate(page_paths, start=1):
        try:
            with Image.open(path) as source:
                image = source.convert("RGB")
                if image.size != (1754, 1241):
                    errors.append(
                        f"rendered page {index} size {image.size} does not match 150 DPI A4 landscape (1754, 1241)"
                    )
                if page_size is None:
                    page_size = image.size
                elif image.size != page_size:
                    errors.append(f"rendered page {index} size {image.size} differs from {page_size}")
                sample = image.resize((160, 113), Image.Resampling.BILINEAR).convert("L")
                white_ratio = sum(pixel >= 245 for pixel in sample.get_flattened_data()) / (160 * 113)
                if white_ratio > 0.98:
                    errors.append(f"rendered page {index} is more than 98% near-white")
                thumbnail = image.copy()
                thumbnail.thumbnail((360, 255), Image.Resampling.LANCZOS)
                thumbnails.append(thumbnail)
        except OSError as exc:
            errors.append(f"cannot decode rendered page {index}: {exc}")

    if len(thumbnails) == 10:
        sheet = Image.new("RGB", (1920, 590), (23, 39, 51))
        sheet_draw = ImageDraw.Draw(sheet)
        for index, thumbnail in enumerate(thumbnails):
            column, row = index % 5, index // 5
            x = 20 + column * 380
            y = 25 + row * 280
            sheet_draw.rectangle((x - 2, y - 2, x + 362, y + 257), outline=(181, 138, 58), width=2)
            sheet.paste(thumbnail, (x + (360 - thumbnail.width) // 2, y))
            sheet_draw.text((x + 6, y + 260), f"PAGE {index + 1:02d}", fill=(247, 245, 239))
        rendered.mkdir(parents=True, exist_ok=True)
        sheet.save(rendered / "contact-sheet.png", format="PNG", optimize=True)

    contact = rendered / "contact-sheet.png"
    if not contact.exists():
        errors.append("missing rendered contact sheet")
    else:
        with Image.open(contact) as sheet:
            if sum(ImageStat.Stat(sheet.convert("RGB")).var) <= 10.0:
                errors.append("rendered contact sheet has insufficient pixel variance")
    return errors


def build_manifest() -> dict:
    from PIL import Image
    from pypdf import PdfReader

    cover_path = ROOT / "地质知识图谱与RAG项目封面.png"
    pdf_path = ROOT / "地质知识图谱与RAG项目作品集.pdf"
    copy_path = ROOT / "作品上传文案.txt"
    content = load_content()
    with Image.open(cover_path) as cover:
        cover_dimensions = list(cover.size)
    reader = PdfReader(str(pdf_path))
    description = extract_upload_description(copy_path.read_text(encoding="utf-8"))
    return {
        "cover_dimensions": cover_dimensions,
        "cover_bytes": cover_path.stat().st_size,
        "pdf_pages": len(reader.pages),
        "pdf_bytes": pdf_path.stat().st_size,
        "description_characters": len(description),
        "github": content["github"]["repository"],
        "deliverables": [
            str(cover_path.resolve()),
            str(pdf_path.resolve()),
            str(copy_path.resolve()),
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--content-only", action="store_true")
    mode.add_argument("--images-only", action="store_true")
    mode.add_argument("--pdf-only", action="store_true")
    mode.add_argument("--rendered-only", action="store_true")
    mode.add_argument("--all", action="store_true")
    args = parser.parse_args()

    if args.images_only:
        groups = [("images", validate_images)]
    elif args.pdf_only:
        groups = [("pdf", validate_pdf)]
    elif args.rendered_only:
        groups = [("rendered", validate_rendered_pages)]
    elif args.all:
        groups = [
            ("content", validate_content),
            ("images", validate_images),
            ("pdf", validate_pdf),
            ("rendered", validate_rendered_pages),
        ]
    else:
        groups = [("content", validate_content)]

    all_errors: list[str] = []
    for name, validator in groups:
        errors = validator()
        if errors:
            all_errors.extend(f"{name}: {error}" for error in errors)
            print(f"FAIL {name} ({len(errors)} errors)")
        else:
            print(f"PASS {name}")
    for error in all_errors:
        print(f"- {error}")
    if not all_errors and args.all:
        print(json.dumps(build_manifest(), ensure_ascii=False, indent=2))
    return 1 if all_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
