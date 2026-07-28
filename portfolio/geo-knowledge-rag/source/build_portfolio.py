"""Build the ten-page geological RAG recruitment portfolio PDF."""

from __future__ import annotations

import json
from pathlib import Path
import sys

from PIL import Image
from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as canvas_module


SOURCE_DIR = Path(__file__).resolve().parent
if str(SOURCE_DIR) not in sys.path:
    sys.path.insert(0, str(SOURCE_DIR))

from font_config import resolve_fonts


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source"
ASSETS = ROOT / "assets"
CONTENT_PATH = SOURCE / "content.json"
COVER_PATH = ROOT / "地质知识图谱与RAG项目封面.png"
PDF_PATH = ROOT / "地质知识图谱与RAG项目作品集.pdf"

PAGE_W, PAGE_H = landscape(A4)
MARGIN_X = 42
MARGIN_TOP = 36
MARGIN_BOTTOM = 30

FONT_PATHS = resolve_fonts()
FONT_REGULAR = FONT_PATHS["regular"]
FONT_BOLD = FONT_PATHS["bold"]
FONT_SERIF = FONT_PATHS["serif"]
FONT_LATIN = FONT_PATHS["latin"]


def clean_text(text: str) -> str:
    return text.replace("—", "-").replace("–", "-").replace("‑", "-")


def register_fonts() -> dict[str, str]:
    paths = {
        "body": ("PortfolioBody", FONT_REGULAR),
        "bold": ("PortfolioBold", FONT_BOLD),
        "display": ("PortfolioDisplay", FONT_SERIF),
        "latin": ("PortfolioLatin", FONT_LATIN),
    }
    for _, path in paths.values():
        if not path.exists():
            raise FileNotFoundError(f"missing required font: {path}")
    registered = set(pdfmetrics.getRegisteredFontNames())
    for name, path in paths.values():
        if name not in registered:
            pdfmetrics.registerFont(TTFont(name, str(path)))
    return {key: name for key, (name, _) in paths.items()}


def load_content() -> dict:
    return json.loads(CONTENT_PATH.read_text(encoding="utf-8"))


def colors(content: dict) -> dict[str, Color]:
    return {key: HexColor(value) for key, value in content["palette"].items()}


def page_by_slug(content: dict, slug: str) -> dict:
    return next(item for item in content["pages"] if item["slug"] == slug)


def wrap_lines(text: str, font_name: str, size: float, width: float) -> list[str]:
    text = clean_text(text)
    lines: list[str] = []
    current = ""
    for character in text:
        if character == "\n":
            lines.append(current.rstrip())
            current = ""
            continue
        candidate = current + character
        if current and pdfmetrics.stringWidth(candidate, font_name, size) > width:
            lines.append(current.rstrip())
            current = character.lstrip()
        else:
            current = candidate
    if current:
        lines.append(current.rstrip())
    return lines or [""]


def draw_wrapped_text(
    pdf_canvas,
    text: str,
    x: float,
    y: float,
    width: float,
    font_name: str,
    size: float,
    leading: float,
    color: Color,
) -> float:
    pdf_canvas.setFillColor(color)
    pdf_canvas.setFont(font_name, size)
    for line in wrap_lines(text, font_name, size, width):
        pdf_canvas.drawString(x, y, line)
        y -= leading
    return y


def draw_header(pdf_canvas, page_data: dict, fonts: dict[str, str]) -> None:
    palette = pdf_canvas._portfolio_colors
    pdf_canvas.setFillColor(palette["green"])
    pdf_canvas.rect(0, PAGE_H - 8, PAGE_W, 8, stroke=0, fill=1)
    pdf_canvas.setFillColor(palette["gold"])
    pdf_canvas.setFont(fonts["latin"], 8.5)
    pdf_canvas.drawString(MARGIN_X, PAGE_H - 38, clean_text(page_data["eyebrow"]))
    pdf_canvas.setFillColor(palette["ink"])
    pdf_canvas.setFont(fonts["display"], 25)
    pdf_canvas.drawString(MARGIN_X, PAGE_H - 71, clean_text(page_data["title"]))
    pdf_canvas.setFillColor(palette["muted"])
    pdf_canvas.setFont(fonts["body"], 10)
    pdf_canvas.drawString(MARGIN_X, PAGE_H - 91, clean_text(page_data["question"]))
    pdf_canvas.setStrokeColor(palette["line"])
    pdf_canvas.setLineWidth(0.7)
    pdf_canvas.line(MARGIN_X, PAGE_H - 106, PAGE_W - MARGIN_X, PAGE_H - 106)


def draw_footer(pdf_canvas, page_number: int, fonts: dict[str, str]) -> None:
    palette = pdf_canvas._portfolio_colors
    pdf_canvas.setStrokeColor(palette["line"])
    pdf_canvas.setLineWidth(0.5)
    pdf_canvas.line(MARGIN_X, 31, PAGE_W - MARGIN_X, 31)
    pdf_canvas.setFont(fonts["latin"], 6.8)
    pdf_canvas.setFillColor(palette["muted"])
    pdf_canvas.drawString(MARGIN_X, 18, "GEO-KNOWLEDGE Q&A / SYNTHETIC PUBLIC CASE STUDY")
    pdf_canvas.setFont(fonts["body"], 6.8)
    notice = "公开展示内容均为合成示例"
    notice_width = pdfmetrics.stringWidth(notice, fonts["body"], 6.8)
    pdf_canvas.drawString(PAGE_W - MARGIN_X - notice_width - 26, 18, notice)
    pdf_canvas.setFont(fonts["latin"], 7.2)
    pdf_canvas.setFillColor(palette["gold"])
    pdf_canvas.drawRightString(PAGE_W - MARGIN_X, 18, f"{page_number:02d}")


def draw_figure(
    pdf_canvas,
    image_path: Path,
    x: float,
    y: float,
    width: float,
    height: float,
) -> None:
    with Image.open(image_path) as image:
        source_w, source_h = image.size
    scale = min(width / source_w, height / source_h)
    draw_w, draw_h = source_w * scale, source_h * scale
    draw_x = x + (width - draw_w) / 2
    draw_y = y + (height - draw_h) / 2
    pdf_canvas.drawImage(ImageReader(str(image_path)), draw_x, draw_y, width=draw_w, height=draw_h, mask="auto")


def draw_evidence_list(
    pdf_canvas,
    items: list[str],
    x: float,
    y: float,
    width: float,
    fonts: dict[str, str],
) -> float:
    palette = pdf_canvas._portfolio_colors
    for item in items:
        pdf_canvas.setFillColor(palette["green"])
        pdf_canvas.rect(x, y - 2, 6, 6, stroke=0, fill=1)
        y = draw_wrapped_text(pdf_canvas, item, x + 15, y, width - 15, fonts["body"], 9.2, 14, palette["ink"])
        y -= 4
    return y


def draw_tag_row(pdf_canvas, items: list[str], x: float, y: float, fonts: dict[str, str], max_x: float) -> None:
    palette = pdf_canvas._portfolio_colors
    for item in items:
        label = clean_text(item)
        width = pdfmetrics.stringWidth(label, fonts["body"], 8.2) + 20
        if x + width > max_x:
            break
        pdf_canvas.setFillColor(palette["white"])
        pdf_canvas.setStrokeColor(palette["line"])
        pdf_canvas.roundRect(x, y - 8, width, 22, 3, stroke=1, fill=1)
        pdf_canvas.setFillColor(palette["ink"])
        pdf_canvas.setFont(fonts["body"], 8.2)
        pdf_canvas.drawString(x + 10, y - 1, label)
        x += width + 8


def draw_cover_page(pdf_canvas, content: dict) -> None:
    palette = pdf_canvas._portfolio_colors
    pdf_canvas.setFillColor(palette["ink"])
    pdf_canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    draw_figure(pdf_canvas, COVER_PATH, 0, 0, PAGE_W, PAGE_H)


def draw_problem_page(pdf_canvas, content: dict, fonts: dict[str, str]) -> None:
    data = page_by_slug(content, "problem")
    palette = pdf_canvas._portfolio_colors
    draw_header(pdf_canvas, data, fonts)
    summary_y = PAGE_H - 137
    draw_wrapped_text(pdf_canvas, data["summary"], MARGIN_X, summary_y, PAGE_W - MARGIN_X * 2, fonts["body"], 11.5, 18, palette["ink"])
    draw_tag_row(pdf_canvas, data["evidence"], MARGIN_X, PAGE_H - 187, fonts, PAGE_W - MARGIN_X)

    card_width = (PAGE_W - MARGIN_X * 2 - 18) / 2
    card_height = 122
    positions = [
        (MARGIN_X, 264),
        (MARGIN_X + card_width + 18, 264),
        (MARGIN_X, 124),
        (MARGIN_X + card_width + 18, 124),
    ]
    for row, (x, y) in zip(data["problem_rows"], positions):
        pdf_canvas.setFillColor(palette["white"])
        pdf_canvas.setStrokeColor(palette["line"])
        pdf_canvas.roundRect(x, y, card_width, card_height, 4, stroke=1, fill=1)
        pdf_canvas.setFillColor(palette["gold"])
        pdf_canvas.rect(x, y, 7, card_height, stroke=0, fill=1)
        pdf_canvas.setFont(fonts["latin"], 8)
        pdf_canvas.drawString(x + 23, y + 92, row["signal"])
        pdf_canvas.setFillColor(palette["ink"])
        pdf_canvas.setFont(fonts["bold"], 15)
        pdf_canvas.drawString(x + 58, y + 86, row["title"])
        draw_wrapped_text(pdf_canvas, row["detail"], x + 23, y + 57, card_width - 46, fonts["body"], 9.2, 14, palette["muted"])
    draw_footer(pdf_canvas, data["number"], fonts)


def draw_asset_page(pdf_canvas, content: dict, fonts: dict[str, str], slug: str, filename: str) -> None:
    data = page_by_slug(content, slug)
    palette = pdf_canvas._portfolio_colors
    pdf_canvas.setFillColor(palette["paper"])
    pdf_canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    draw_figure(pdf_canvas, ASSETS / filename, 24, 48, PAGE_W - 48, PAGE_H - 72)
    draw_footer(pdf_canvas, data["number"], fonts)


def draw_challenges_page(pdf_canvas, content: dict, fonts: dict[str, str]) -> None:
    data = page_by_slug(content, "challenges")
    palette = pdf_canvas._portfolio_colors
    draw_header(pdf_canvas, data, fonts)
    draw_wrapped_text(pdf_canvas, data["summary"], MARGIN_X, PAGE_H - 137, PAGE_W - MARGIN_X * 2, fonts["body"], 11.2, 17, palette["ink"])

    left, top = MARGIN_X, 403
    widths = [145, 256, PAGE_W - MARGIN_X * 2 - 145 - 256]
    headers = ["ENGINEERING RISK", "DECISION", "RESULT"]
    x = left
    pdf_canvas.setFillColor(palette["ink"])
    pdf_canvas.rect(left, top, sum(widths), 35, stroke=0, fill=1)
    for label, width in zip(headers, widths):
        pdf_canvas.setFillColor(palette["gold"])
        pdf_canvas.setFont(fonts["latin"], 7.6)
        pdf_canvas.drawString(x + 14, top + 13, label)
        x += width

    row_height = 78
    for index, item in enumerate(data["challenges"]):
        y = top - (index + 1) * row_height
        pdf_canvas.setFillColor(palette["white"] if index % 2 == 0 else HexColor("#EFF1EB"))
        pdf_canvas.rect(left, y, sum(widths), row_height, stroke=0, fill=1)
        pdf_canvas.setStrokeColor(palette["line"])
        pdf_canvas.line(left, y, left + sum(widths), y)
        x = left
        values = [item["title"], item["decision"], item["outcome"]]
        for column, (value, width) in enumerate(zip(values, widths)):
            text_font = fonts["bold"] if column == 0 else fonts["body"]
            text_color = palette["ink"] if column != 2 else palette["green"]
            draw_wrapped_text(pdf_canvas, value, x + 14, y + 48, width - 28, text_font, 9.2, 14, text_color)
            x += width
    draw_footer(pdf_canvas, data["number"], fonts)


def draw_verification_page(pdf_canvas, content: dict, fonts: dict[str, str]) -> None:
    data = page_by_slug(content, "verification")
    palette = pdf_canvas._portfolio_colors
    draw_header(pdf_canvas, data, fonts)
    draw_wrapped_text(pdf_canvas, data["summary"], MARGIN_X, PAGE_H - 137, PAGE_W - MARGIN_X * 2, fonts["body"], 11.2, 17, palette["ink"])

    gap = 12
    card_w = (PAGE_W - MARGIN_X * 2 - gap * 3) / 4
    card_y, card_h = 244, 180
    for index, item in enumerate(data["verification"]):
        x = MARGIN_X + index * (card_w + gap)
        pdf_canvas.setFillColor(palette["white"])
        pdf_canvas.setStrokeColor(palette["line"])
        pdf_canvas.roundRect(x, card_y, card_w, card_h, 4, stroke=1, fill=1)
        pdf_canvas.setFillColor(palette["green"] if index < 3 else palette["gold"])
        pdf_canvas.rect(x, card_y + card_h - 8, card_w, 8, stroke=0, fill=1)
        pdf_canvas.setFillColor(palette["gold"])
        pdf_canvas.setFont(fonts["latin"], 8)
        pdf_canvas.drawString(x + 18, card_y + 137, f"0{index + 1}")
        pdf_canvas.setFillColor(palette["ink"])
        pdf_canvas.setFont(fonts["bold"], 13)
        pdf_canvas.drawString(x + 18, card_y + 108, item["title"])
        draw_wrapped_text(pdf_canvas, item["detail"], x + 18, card_y + 77, card_w - 36, fonts["body"], 8.8, 14, palette["muted"])

    pdf_canvas.setFillColor(palette["ink"])
    pdf_canvas.rect(MARGIN_X, 91, PAGE_W - MARGIN_X * 2, 105, stroke=0, fill=1)
    pdf_canvas.setFillColor(palette["gold"])
    pdf_canvas.setFont(fonts["latin"], 8)
    pdf_canvas.drawString(MARGIN_X + 22, 169, "PUBLIC RELEASE GATE")
    label_x = MARGIN_X + 22
    for label in data["privacy_labels"]:
        width = pdfmetrics.stringWidth(label, fonts["latin"], 8) + 28
        pdf_canvas.setStrokeColor(palette["green"])
        pdf_canvas.roundRect(label_x, 118, width, 30, 3, stroke=1, fill=0)
        pdf_canvas.setFillColor(palette["paper"])
        pdf_canvas.setFont(fonts["latin"], 8)
        pdf_canvas.drawString(label_x + 14, 128, label)
        label_x += width + 12
    draw_footer(pdf_canvas, data["number"], fonts)


def draw_links_page(pdf_canvas, content: dict, fonts: dict[str, str]) -> None:
    data = page_by_slug(content, "links")
    palette = pdf_canvas._portfolio_colors
    draw_header(pdf_canvas, data, fonts)
    draw_wrapped_text(pdf_canvas, data["summary"], MARGIN_X, PAGE_H - 137, PAGE_W - MARGIN_X * 2, fonts["body"], 11.2, 17, palette["ink"])

    card_w = (PAGE_W - MARGIN_X * 2 - 16) / 2
    card_h = 78
    for index, stack in enumerate(data["stack"]):
        column = index % 2
        row = index // 2
        x = MARGIN_X + column * (card_w + 16)
        y = 310 - row * 94
        pdf_canvas.setFillColor(palette["white"])
        pdf_canvas.setStrokeColor(palette["line"])
        pdf_canvas.roundRect(x, y, card_w, card_h, 4, stroke=1, fill=1)
        pdf_canvas.setFillColor(palette["green"] if index % 2 == 0 else palette["gold"])
        pdf_canvas.rect(x, y, 7, card_h, stroke=0, fill=1)
        pdf_canvas.setFillColor(palette["gold"])
        pdf_canvas.setFont(fonts["latin"], 7.5)
        pdf_canvas.drawString(x + 20, y + 52, stack["group"])
        items = "  /  ".join(stack["items"])
        fitted_size = 9.0
        while fitted_size > 7 and pdfmetrics.stringWidth(items, fonts["body"], fitted_size) > card_w - 40:
            fitted_size -= 0.25
        pdf_canvas.setFillColor(palette["ink"])
        pdf_canvas.setFont(fonts["body"], fitted_size)
        pdf_canvas.drawString(x + 20, y + 23, items)

    link_y = 87
    link_h = 66
    link_w = (PAGE_W - MARGIN_X * 2 - 16) / 2
    for index, link in enumerate(data["links"]):
        x = MARGIN_X + index * (link_w + 16)
        pdf_canvas.setFillColor(palette["ink"])
        pdf_canvas.roundRect(x, link_y, link_w, link_h, 4, stroke=0, fill=1)
        pdf_canvas.setFillColor(palette["gold"])
        pdf_canvas.setFont(fonts["latin"], 7.5)
        pdf_canvas.drawString(x + 18, link_y + 42, link["label"])
        pdf_canvas.setFillColor(palette["paper"])
        pdf_canvas.setFont(fonts["latin"], 8.4)
        pdf_canvas.drawString(x + 18, link_y + 20, link["url"])
        pdf_canvas.linkURL(link["url"], (x, link_y, x + link_w, link_y + link_h), relative=0, thickness=0)
    draw_footer(pdf_canvas, data["number"], fonts)


def build_pdf(content: dict, output: Path) -> None:
    fonts = register_fonts()
    palette = colors(content)
    output.parent.mkdir(parents=True, exist_ok=True)
    pdf_canvas = canvas_module.Canvas(
        str(output),
        pagesize=(PAGE_W, PAGE_H),
        pageCompression=1,
        invariant=1,
    )
    pdf_canvas._portfolio_colors = palette
    pdf_canvas.setTitle("地质知识图谱与 RAG 增强智能问答系统｜项目作品集")
    pdf_canvas.setAuthor("全链路项目负责人 / Full-stack & AI Engineering")
    pdf_canvas.setSubject("RAG、知识图谱、LLM 与 GIS 融合项目案例")
    pdf_canvas.setCreator("Geo-Knowledge Q&A Portfolio Builder")
    pdf_canvas.setKeywords("RAG, Neo4j, LLM, GIS, Vue, Express, Flask")

    draw_cover_page(pdf_canvas, content)
    pdf_canvas.showPage()
    pdf_canvas._portfolio_colors = palette

    draw_problem_page(pdf_canvas, content, fonts)
    pdf_canvas.showPage()
    pdf_canvas._portfolio_colors = palette

    asset_pages = [
        ("architecture", "architecture.png"),
        ("offline", "offline-pipeline.png"),
        ("online", "online-pipeline.png"),
        ("experience", "product-mock.png"),
        ("contribution", "contribution-matrix.png"),
    ]
    for slug, filename in asset_pages:
        draw_asset_page(pdf_canvas, content, fonts, slug, filename)
        pdf_canvas.showPage()
        pdf_canvas._portfolio_colors = palette

    draw_challenges_page(pdf_canvas, content, fonts)
    pdf_canvas.showPage()
    pdf_canvas._portfolio_colors = palette
    draw_verification_page(pdf_canvas, content, fonts)
    pdf_canvas.showPage()
    pdf_canvas._portfolio_colors = palette
    draw_links_page(pdf_canvas, content, fonts)
    pdf_canvas.showPage()
    pdf_canvas.save()


def main() -> int:
    content = load_content()
    build_pdf(content, PDF_PATH)
    print(f"Built 10-page portfolio PDF: {PDF_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
