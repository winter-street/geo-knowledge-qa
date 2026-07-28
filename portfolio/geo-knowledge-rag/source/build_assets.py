"""Build the cover and technical visuals for the geological RAG portfolio."""

from __future__ import annotations

import json
import math
import random
from pathlib import Path
import sys
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont


SOURCE_DIR = Path(__file__).resolve().parent
if str(SOURCE_DIR) not in sys.path:
    sys.path.insert(0, str(SOURCE_DIR))

from font_config import resolve_fonts


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source"
ASSETS = ROOT / "assets"
CONTENT_PATH = SOURCE / "content.json"
BACKGROUND_PATH = ASSETS / "cover-background.png"
COVER_PATH = ROOT / "地质知识图谱与RAG项目封面.png"

CANVAS = (2200, 1240)
COVER = (1600, 900)
BACKGROUND = (2048, 1152)

FONT_PATHS = resolve_fonts()
FONT_REGULAR = FONT_PATHS["regular"]
FONT_BOLD = FONT_PATHS["bold"]
FONT_SERIF = FONT_PATHS["serif"]
FONT_LATIN = FONT_PATHS["latin"]


def load_fonts() -> dict[str, Path]:
    return resolve_fonts()


def font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(load_fonts()[weight]), size=size)


def fit_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font_path: Path,
    max_size: int,
    max_width: int,
) -> ImageFont.FreeTypeFont:
    for size in range(max_size, 11, -1):
        candidate = ImageFont.truetype(str(font_path), size=size)
        if draw.textbbox((0, 0), text, font=candidate)[2] <= max_width:
            return candidate
    return ImageFont.truetype(str(font_path), size=12)


def rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))


def blend(a: str, b: str, amount: float) -> tuple[int, int, int]:
    first, second = rgb(a), rgb(b)
    return tuple(round(x + (y - x) * amount) for x, y in zip(first, second))


def load_content() -> dict:
    return json.loads(CONTENT_PATH.read_text(encoding="utf-8"))


def page(content: dict, slug: str) -> dict:
    return next(item for item in content["pages"] if item["slug"] == slug)


def text_width(draw: ImageDraw.ImageDraw, text: str, text_font: ImageFont.FreeTypeFont) -> float:
    box = draw.textbbox((0, 0), text, font=text_font)
    return box[2] - box[0]


def wrap_lines(
    draw: ImageDraw.ImageDraw,
    text: str,
    text_font: ImageFont.FreeTypeFont,
    max_width: int,
    max_lines: int | None = None,
) -> list[str]:
    lines: list[str] = []
    current = ""
    for character in text:
        if character == "\n":
            lines.append(current.rstrip())
            current = ""
            continue
        candidate = current + character
        if current and text_width(draw, candidate, text_font) > max_width:
            lines.append(current.rstrip())
            current = character.lstrip()
        else:
            current = candidate
    if current:
        lines.append(current.rstrip())
    if max_lines and len(lines) > max_lines:
        lines = lines[:max_lines]
        while lines[-1] and text_width(draw, lines[-1] + "…", text_font) > max_width:
            lines[-1] = lines[-1][:-1]
        lines[-1] += "…"
    return lines or [""]


def draw_wrapped(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    text_font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int],
    max_width: int,
    line_gap: int = 10,
    max_lines: int | None = None,
) -> int:
    x, y = xy
    lines = wrap_lines(draw, text, text_font, max_width, max_lines=max_lines)
    line_height = draw.textbbox((0, 0), "示例Ag", font=text_font)[3]
    for line in lines:
        draw.text((x, y), line, font=text_font, fill=fill)
        y += line_height + line_gap
    return y


def draw_rule(draw: ImageDraw.ImageDraw, xy: tuple[int, int, int, int], color: tuple[int, int, int], width: int = 2) -> None:
    draw.line(xy, fill=color, width=width)


def draw_arrow(
    draw: ImageDraw.ImageDraw,
    start: tuple[int, int],
    end: tuple[int, int],
    color: tuple[int, int, int],
    width: int = 4,
    head: int = 13,
) -> None:
    draw.line((*start, *end), fill=color, width=width)
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    left = (
        end[0] - head * math.cos(angle - math.pi / 6),
        end[1] - head * math.sin(angle - math.pi / 6),
    )
    right = (
        end[0] - head * math.cos(angle + math.pi / 6),
        end[1] - head * math.sin(angle + math.pi / 6),
    )
    draw.polygon([end, left, right], fill=color)


def base_canvas(content: dict) -> tuple[Image.Image, ImageDraw.ImageDraw, dict[str, tuple[int, int, int]]]:
    colors = {name: rgb(value) for name, value in content["palette"].items()}
    image = Image.new("RGB", CANVAS, colors["paper"])
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, CANVAS[0], 16), fill=colors["green"])
    return image, draw, colors


def draw_asset_header(
    draw: ImageDraw.ImageDraw,
    colors: dict[str, tuple[int, int, int]],
    index: str,
    label: str,
    caption: str,
) -> None:
    draw.text((96, 70), index, font=font(25, "latin"), fill=colors["gold"])
    draw.text((160, 60), label, font=font(34, "bold"), fill=colors["ink"])
    draw.text((160, 108), caption, font=font(22), fill=colors["muted"])
    draw_rule(draw, (96, 156, 2104, 156), colors["line"], 2)


def draw_cover_background(output: Path) -> None:
    content = load_content()
    colors = {name: rgb(value) for name, value in content["palette"].items()}
    image = Image.new("RGB", BACKGROUND, colors["ink"])
    draw = ImageDraw.Draw(image)

    # Quiet editorial field at left, abstract strata and graph activity at right.
    draw.polygon(
        [(860, 0), (2048, 0), (2048, 360), (1600, 300), (1120, 460)],
        fill=blend(content["palette"]["ink"], content["palette"]["green"], 0.20),
    )
    draw.polygon(
        [(1040, 1152), (2048, 1152), (2048, 670), (1720, 610), (1300, 770)],
        fill=blend(content["palette"]["ink"], content["palette"]["gold"], 0.14),
    )

    grid = blend(content["palette"]["ink"], content["palette"]["paper"], 0.12)
    for x in range(896, BACKGROUND[0], 96):
        draw.line((x, 0, x, BACKGROUND[1]), fill=grid, width=1)
    for y in range(0, BACKGROUND[1], 96):
        draw.line((896, y, BACKGROUND[0], y), fill=grid, width=1)

    random.seed(17)
    contour_green = blend(content["palette"]["ink"], content["palette"]["green"], 0.64)
    contour_gold = blend(content["palette"]["ink"], content["palette"]["gold"], 0.56)
    for index in range(18):
        base_y = 80 + index * 61
        phase = random.uniform(0, math.pi * 2)
        points = []
        for x in range(760, 2180, 24):
            y = base_y + 52 * math.sin(x / 170 + phase) + 24 * math.cos(x / 83 + phase / 2)
            points.append((x, round(y)))
        color = contour_gold if index in {3, 10, 15} else contour_green
        draw.line(points, fill=color, width=2 if index in {3, 10, 15} else 1)

    nodes = [(1110, 330), (1350, 214), (1460, 482), (1710, 350), (1880, 540), (1580, 725), (1850, 870), (1240, 900)]
    path_color = colors["gold"]
    for start, end in zip(nodes, nodes[1:]):
        draw.line((*start, *end), fill=path_color, width=3)
    for index, (x, y) in enumerate(nodes):
        radius = 12 if index in {0, 3, 6} else 8
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=colors["ink"], outline=colors["green"], width=4)
        draw.line((x - 22, y, x + 22, y), fill=blend(content["palette"]["ink"], content["palette"]["paper"], 0.32), width=1)
        draw.line((x, y - 22, x, y + 22), fill=blend(content["palette"]["ink"], content["palette"]["paper"], 0.32), width=1)

    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, format="PNG", optimize=True)


def draw_cover(content: dict, background: Path, output: Path) -> None:
    colors = {name: rgb(value) for name, value in content["palette"].items()}
    with Image.open(background) as source:
        image = source.convert("RGB").resize(COVER, Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(image)

    # Flat translucent-looking block implemented as a solid palette blend.
    draw.rectangle((0, 0, 860, 900), fill=blend(content["palette"]["ink"], "#000000", 0.10))
    draw.rectangle((104, 112, 111, 705), fill=colors["gold"])
    draw.text((148, 108), "PROJECT CASE STUDY  /  2026", font=font(22, "latin"), fill=colors["gold"])
    draw.text((148, 166), "地质知识图谱与 RAG", font=font(61, "bold"), fill=colors["paper"])
    draw.text((148, 250), "增强智能问答系统", font=font(61, "bold"), fill=colors["paper"])
    draw_wrapped(
        draw,
        (148, 364),
        content["meta"]["tagline"],
        font(30),
        blend(content["palette"]["paper"], content["palette"]["muted"], 0.18),
        600,
        line_gap=8,
        max_lines=2,
    )

    draw_rule(draw, (148, 490, 720, 490), blend(content["palette"]["ink"], content["palette"]["paper"], 0.28), 2)
    draw.text((148, 526), content["meta"]["role"], font=font(25, "bold"), fill=colors["paper"])
    draw.text((148, 570), content["meta"]["role_en"], font=font(21, "latin"), fill=colors["green"])
    draw.text((148, 620), content["meta"]["team_context"], font=font(19), fill=blend(content["palette"]["paper"], content["palette"]["muted"], 0.25))

    draw.text((104, 810), "RAG   NEO4J   LLM   GIS", font=font(18, "latin"), fill=colors["gold"])
    notice = content["meta"]["synthetic_notice"]
    notice_font = font(16)
    notice_width = text_width(draw, notice, notice_font)
    draw.rectangle((1560 - notice_width - 24, 817, 1560, 856), fill=colors["paper"])
    draw.text((1548 - notice_width, 826), notice, font=notice_font, fill=colors["ink"])
    image.save(output, format="PNG", optimize=True)


def draw_architecture(content: dict, output: Path) -> None:
    image, draw, colors = base_canvas(content)
    data = page(content, "architecture")
    draw_asset_header(draw, colors, "03", "SYSTEM ARCHITECTURE", "双路取证、模型生成与空间反馈形成完整闭环")

    left, top, width, row_height = 96, 210, 1540, 180
    fills = [
        blend(content["palette"]["paper"], content["palette"]["green"], 0.08),
        colors["white"],
        blend(content["palette"]["paper"], content["palette"]["gold"], 0.09),
        colors["white"],
    ]
    for index, layer in enumerate(data["architecture"]["layers"]):
        y = top + index * (row_height + 18)
        draw.rectangle((left, y, left + width, y + row_height), fill=fills[index], outline=colors["line"], width=2)
        draw.rectangle((left, y, left + 210, y + row_height), fill=colors["ink"] if index % 2 == 0 else colors["green"])
        draw.text((left + 34, y + 34), f"L{index + 1}", font=font(18, "latin"), fill=colors["gold"] if index % 2 == 0 else colors["paper"])
        draw.text((left + 34, y + 78), layer["name"], font=font(30, "bold"), fill=colors["paper"])
        item_x = left + 252
        item_width = 292
        for item_index, item in enumerate(layer["items"]):
            box_x = item_x + item_index * 310
            draw.rectangle((box_x, y + 44, box_x + item_width, y + 136), outline=colors["line"], width=2)
            item_font = fit_text(draw, item, FONT_BOLD, 24, item_width - 36)
            item_w = text_width(draw, item, item_font)
            draw.text((box_x + (item_width - item_w) / 2, y + 75), item, font=item_font, fill=colors["ink"])
        if index < 3:
            draw_arrow(draw, (left + width // 2, y + row_height), (left + width // 2, y + row_height + 18), colors["gold"], width=4, head=11)

    panel_x = 1706
    draw.text((panel_x, 218), "EVIDENCE LOOP", font=font(20, "latin"), fill=colors["gold"])
    draw_wrapped(draw, (panel_x, 262), data["summary"], font(22), colors["ink"], 390, line_gap=12, max_lines=5)
    loop = data["architecture"]["loop"]
    for index, label in enumerate(loop):
        y = 480 + index * 126
        draw.ellipse((panel_x, y, panel_x + 66, y + 66), fill=colors["ink"] if index in {0, 4} else colors["green"])
        draw.text((panel_x + 22, y + 19), str(index + 1), font=font(18, "latin"), fill=colors["paper"])
        draw.text((panel_x + 92, y + 16), label, font=font(27, "bold"), fill=colors["ink"])
        if index < len(loop) - 1:
            draw_arrow(draw, (panel_x + 33, y + 70), (panel_x + 33, y + 118), colors["gold"], width=3, head=10)
    image.save(output, format="PNG", optimize=True)


def draw_offline_pipeline(content: dict, output: Path) -> None:
    image, draw, colors = base_canvas(content)
    data = page(content, "offline")
    draw_asset_header(draw, colors, "04", "OFFLINE KNOWLEDGE PIPELINE", "从资料解析到图谱与推理的可重入处理链")

    steps = data["pipeline"]
    start_x, y, box_w, gap = 96, 260, 310, 30
    for index, step in enumerate(steps):
        x = start_x + index * (box_w + gap)
        draw.text((x, y), step["step"], font=font(20, "latin"), fill=colors["gold"])
        draw.rectangle((x, y + 44, x + box_w, y + 340), fill=colors["white"], outline=colors["line"], width=2)
        draw.rectangle((x, y + 44, x + box_w, y + 54), fill=colors["green"] if index < 3 else colors["gold"])
        draw.text((x + 28, y + 92), step["title"], font=font(28, "bold"), fill=colors["ink"])
        draw_wrapped(draw, (x + 28, y + 152), step["detail"], font(21), colors["muted"], box_w - 56, line_gap=12, max_lines=4)
        symbol = ["TXT", "CHK", "VEC", "NER", "KG", "OWL"][index]
        draw.rectangle((x + 28, y + 278, x + 112, y + 316), fill=blend(content["palette"]["paper"], content["palette"]["green"], 0.18))
        draw.text((x + 42, y + 287), symbol, font=font(15, "latin"), fill=colors["ink"])
        if index < len(steps) - 1:
            draw_arrow(draw, (x + box_w, y + 192), (x + box_w + gap - 4, y + 192), colors["gold"], width=4, head=10)

    draw.text((96, 696), "GEOLOGICAL SCHEMA", font=font(20, "latin"), fill=colors["gold"])
    draw.text((96, 744), "统一实体类型让数据管线、图数据库与界面共享同一套语义。", font=font(24), fill=colors["ink"])
    schema_y = 824
    schema_w = 300
    for index, label in enumerate(data["schema"]):
        x = 96 + index * 334
        draw.rectangle((x, schema_y, x + schema_w, schema_y + 116), outline=colors["line"], width=2)
        draw.ellipse((x + 26, schema_y + 37, x + 68, schema_y + 79), fill=colors["green"] if index < 3 else colors["gold"])
        label_font = fit_text(draw, label, FONT_BOLD, 23, 194)
        draw.text((x + 86, schema_y + 43), label, font=label_font, fill=colors["ink"])
    draw.rectangle((96, 1020, 2104, 1112), fill=colors["ink"])
    draw.text((132, 1048), "CACHE", font=font(17, "latin"), fill=colors["gold"])
    draw.text((250, 1040), "缓存解析结果，支持从中间步骤重跑，减少重复计算与外部调用。", font=font(24), fill=colors["paper"])
    image.save(output, format="PNG", optimize=True)


def draw_online_pipeline(content: dict, output: Path) -> None:
    image, draw, colors = base_canvas(content)
    data = page(content, "online")
    draw_asset_header(draw, colors, "05", "ONLINE ANSWER FLOW", "一次提问在证据、生成和界面状态之间流动")

    flow = data["online_flow"]
    xs = [96, 456, 970, 1396, 1740]
    widths = [280, 424, 336, 264, 364]
    y = 244
    for index, item in enumerate(flow):
        x, box_w = xs[index], widths[index]
        draw.text((x, y), item["step"], font=font(18, "latin"), fill=colors["gold"])
        draw.rectangle((x, y + 42, x + box_w, y + 248), fill=colors["white"], outline=colors["line"], width=2)
        draw.rectangle((x, y + 42, x + 9, y + 248), fill=colors["green"] if index != 3 else colors["gold"])
        title_font = fit_text(draw, item["title"], FONT_BOLD, 24, box_w - 58)
        draw.text((x + 32, y + 80), item["title"], font=title_font, fill=colors["ink"])
        draw_wrapped(draw, (x + 32, y + 132), item["detail"], font(20), colors["muted"], box_w - 64, line_gap=10, max_lines=4)
        if index < len(flow) - 1:
            draw_arrow(draw, (x + box_w, y + 148), (xs[index + 1] - 18, y + 148), colors["gold"], width=4, head=10)

    branch_x, branch_y, branch_w = 456, 576, 424
    draw.text((branch_x, branch_y), "PARALLEL EVIDENCE", font=font(18, "latin"), fill=colors["gold"])
    lanes = [
        ("RAG", "文档片段与来源"),
        ("KG", "实体关系路径"),
        ("GIS", "合成空间要素"),
    ]
    for index, (label, detail) in enumerate(lanes):
        lane_y = branch_y + 52 + index * 110
        draw.rectangle((branch_x, lane_y, branch_x + branch_w, lane_y + 82), fill=blend(content["palette"]["paper"], content["palette"]["green"], 0.09), outline=colors["line"], width=2)
        draw.text((branch_x + 24, lane_y + 24), label, font=font(17, "latin"), fill=colors["green"])
        draw.text((branch_x + 116, lane_y + 20), detail, font=font(20, "bold"), fill=colors["ink"])

    draw.rectangle((970, 576, 1644, 964), fill=colors["ink"])
    draw.text((1010, 614), "GROUNDING GATE", font=font(19, "latin"), fill=colors["gold"])
    gate_rows = [
        ("01", "相关性", "证据不足时不强行调用模型"),
        ("02", "组合上下文", "片段、路径和空间语境统一编排"),
        ("03", "异常互备", "模型不可用时返回可读降级结果"),
    ]
    for index, (number, title, detail) in enumerate(gate_rows):
        row_y = 684 + index * 88
        draw.text((1010, row_y), number, font=font(15, "latin"), fill=colors["green"])
        draw.text((1072, row_y - 4), title, font=font(22, "bold"), fill=colors["paper"])
        draw.text((1248, row_y - 2), detail, font=font(18), fill=blend(content["palette"]["ink"], content["palette"]["paper"], 0.72))

    event_x, event_y = 1740, 576
    draw.text((event_x, event_y), "SSE EVENT CONTRACT", font=font(18, "latin"), fill=colors["gold"])
    for index, event in enumerate(data["event_types"]):
        row_y = event_y + 64 + index * 80
        fill = colors["green"] if event != "error" else colors["gold"]
        draw.rectangle((event_x, row_y, event_x + 364, row_y + 56), outline=colors["line"], width=2)
        draw.rectangle((event_x, row_y, event_x + 12, row_y + 56), fill=fill)
        draw.text((event_x + 34, row_y + 14), event.upper(), font=font(17, "latin"), fill=colors["ink"])
    image.save(output, format="PNG", optimize=True)


def draw_product_mock(content: dict, output: Path) -> None:
    image, draw, colors = base_canvas(content)
    data = page(content, "experience")
    mock = data["mock"]
    draw_asset_header(draw, colors, "06", "SYNTHETIC PRODUCT EXPERIENCE", "问答、来源、知识路径与空间结果在同一任务流中互相印证")

    frame = (96, 210, 2104, 1138)
    draw.rectangle(frame, fill=colors["white"], outline=colors["line"], width=2)
    draw.rectangle((96, 210, 2104, 278), fill=colors["ink"])
    draw.ellipse((126, 231, 152, 257), fill=colors["green"])
    draw.text((170, 227), "Geo-Knowledge Q&A", font=font(20, "latin"), fill=colors["paper"])
    draw.text((1780, 230), "SYNTHETIC DEMO", font=font(14, "latin"), fill=colors["gold"])

    left_x, center_x, right_x = 96, 420, 1472
    draw.rectangle((left_x, 278, center_x, 1138), fill=blend(content["palette"]["paper"], content["palette"]["ink"], 0.03))
    draw.rectangle((right_x, 278, 2104, 1138), fill=blend(content["palette"]["paper"], content["palette"]["green"], 0.05))
    draw_rule(draw, (center_x, 278, center_x, 1138), colors["line"], 2)
    draw_rule(draw, (right_x, 278, right_x, 1138), colors["line"], 2)

    draw.text((132, 324), "对话记录", font=font(23, "bold"), fill=colors["ink"])
    conversations = ["构造控制线索", "岩体与矿物关系", "年代与成因", "区域知识概览"]
    for index, item in enumerate(conversations):
        y = 388 + index * 92
        if index == 0:
            draw.rectangle((120, y - 12, 396, y + 54), fill=colors["green"])
        draw.text((142, y + 2), item, font=font(18), fill=colors["paper"] if index == 0 else colors["muted"])
    draw.text((132, 1016), "USER VIEW", font=font(14, "latin"), fill=colors["gold"])
    draw.text((132, 1050), "问答 / 地图 / 图谱", font=font(17), fill=colors["ink"])

    draw.text((466, 324), "智能问答", font=font(25, "bold"), fill=colors["ink"])
    draw.rectangle((466, 386, 1392, 486), fill=blend(content["palette"]["paper"], content["palette"]["green"], 0.10))
    draw.text((494, 406), "QUESTION", font=font(13, "latin"), fill=colors["green"])
    draw_wrapped(draw, (494, 438), mock["question"], font(21, "bold"), colors["ink"], 846, line_gap=6, max_lines=2)

    draw.text((466, 530), "ANSWER", font=font(13, "latin"), fill=colors["gold"])
    draw_wrapped(draw, (466, 566), mock["answer"], font(22), colors["ink"], 890, line_gap=14, max_lines=4)

    draw.rectangle((466, 730, 1392, 824), fill=colors["white"], outline=colors["line"], width=2)
    draw.rectangle((466, 730, 478, 824), fill=colors["gold"])
    draw.text((502, 748), "SOURCE", font=font(13, "latin"), fill=colors["gold"])
    draw.text((622, 746), mock["source"], font=font(19, "bold"), fill=colors["ink"])
    draw.rectangle((466, 852, 1392, 946), fill=colors["white"], outline=colors["line"], width=2)
    draw.rectangle((466, 852, 478, 946), fill=colors["green"])
    draw.text((502, 870), "KG PATH", font=font(13, "latin"), fill=colors["green"])
    path_font = fit_text(draw, mock["path"], FONT_BOLD, 19, 746)
    draw.text((622, 868), mock["path"], font=path_font, fill=colors["ink"])

    draw.rectangle((466, 994, 1392, 1078), outline=colors["line"], width=2)
    draw.text((494, 1018), "继续追问地质关系…", font=font(18), fill=colors["muted"])
    draw.rectangle((1302, 1010, 1364, 1062), fill=colors["ink"])
    draw.polygon([(1324, 1024), (1344, 1036), (1324, 1048)], fill=colors["paper"])

    # Abstract map, deliberately without any geographic labels or coordinate values.
    draw.text((1512, 324), "空间线索", font=font(23, "bold"), fill=colors["ink"])
    map_box = (1512, 384, 2064, 944)
    draw.rectangle(map_box, fill=blend(content["palette"]["paper"], content["palette"]["ink"], 0.03), outline=colors["line"], width=2)
    for x in range(1544, 2050, 72):
        draw.line((x, 398, x, 930), fill=colors["line"], width=1)
    for y in range(416, 930, 72):
        draw.line((1526, y, 2050, y), fill=colors["line"], width=1)
    for index in range(8):
        points = []
        for x in range(1524, 2070, 16):
            line_y = 430 + index * 56 + 22 * math.sin(x / 58 + index)
            points.append((x, round(line_y)))
        draw.line(points, fill=blend(content["palette"]["paper"], content["palette"]["green"], 0.56), width=2)
    map_nodes = [(1664, 534), (1800, 620), (1922, 512), (1880, 784)]
    draw.line([map_nodes[0], map_nodes[1], map_nodes[2], map_nodes[3]], fill=colors["gold"], width=4)
    for index, (x, y) in enumerate(map_nodes):
        radius = 13 if index == 1 else 9
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=colors["ink"], outline=colors["green"], width=4)
    draw_wrapped(draw, (1512, 980), mock["map_label"], font(17), colors["muted"], 552, line_gap=6, max_lines=2)
    image.save(output, format="PNG", optimize=True)


def draw_contribution_matrix(content: dict, output: Path) -> None:
    image, draw, colors = base_canvas(content)
    data = page(content, "contribution")
    draw_asset_header(draw, colors, "07", "CONTRIBUTION MATRIX", "三人课程团队背景下的个人职责边界")

    columns = (96, 456, 1690, 2104)
    header_y = 220
    draw.rectangle((columns[0], header_y, columns[-1], header_y + 84), fill=colors["ink"])
    headers = [("AREA", columns[0] + 28), ("KEY WORK", columns[1] + 28), ("OWNERSHIP", columns[2] + 28)]
    for label, x in headers:
        draw.text((x, header_y + 29), label, font=font(17, "latin"), fill=colors["gold"])

    row_h = 126
    for index, item in enumerate(data["contributions"]):
        y = header_y + 84 + index * row_h
        fill = colors["white"] if index % 2 == 0 else blend(content["palette"]["paper"], content["palette"]["green"], 0.06)
        draw.rectangle((columns[0], y, columns[-1], y + row_h), fill=fill)
        draw_rule(draw, (columns[0], y + row_h, columns[-1], y + row_h), colors["line"], 2)
        draw.text((columns[0] + 28, y + 44), f"0{index + 1}", font=font(16, "latin"), fill=colors["gold"])
        draw.text((columns[0] + 88, y + 36), item["area"], font=font(25, "bold"), fill=colors["ink"])
        draw_wrapped(draw, (columns[1] + 28, y + 32), item["work"], font(22), colors["ink"], columns[2] - columns[1] - 64, line_gap=10, max_lines=2)
        badge_fill = colors["green"] if item["ownership"] in {"主导", "核心实现"} else colors["gold"]
        draw.rectangle((columns[2] + 28, y + 35, columns[2] + 218, y + 91), fill=badge_fill)
        badge_font = fit_text(draw, item["ownership"], FONT_BOLD, 19, 150)
        draw.text((columns[2] + 48, y + 50), item["ownership"], font=badge_font, fill=colors["paper"])

    footer_y = header_y + 84 + len(data["contributions"]) * row_h + 42
    draw.rectangle((96, footer_y, 2104, footer_y + 104), outline=colors["line"], width=2)
    draw.text((128, footer_y + 20), "ROLE", font=font(15, "latin"), fill=colors["gold"])
    draw.text((252, footer_y + 18), content["meta"]["role"], font=font(25, "bold"), fill=colors["ink"])
    draw.text((668, footer_y + 24), content["meta"]["role_en"], font=font(18, "latin"), fill=colors["green"])
    draw.text((1662, footer_y + 25), content["meta"]["team_context"], font=font(20), fill=colors["muted"])
    image.save(output, format="PNG", optimize=True)


def main() -> int:
    load_fonts()
    content = load_content()
    ASSETS.mkdir(parents=True, exist_ok=True)
    draw_cover_background(BACKGROUND_PATH)
    draw_cover(content, BACKGROUND_PATH, COVER_PATH)
    builders: Iterable[tuple[str, callable]] = (
        ("architecture.png", draw_architecture),
        ("offline-pipeline.png", draw_offline_pipeline),
        ("online-pipeline.png", draw_online_pipeline),
        ("product-mock.png", draw_product_mock),
        ("contribution-matrix.png", draw_contribution_matrix),
    )
    for filename, builder in builders:
        builder(content, ASSETS / filename)
    print(f"Built cover and technical assets under {ROOT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
