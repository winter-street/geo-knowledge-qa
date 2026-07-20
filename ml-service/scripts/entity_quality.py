"""Shared high-precision validation for geology entity names."""

from dataclasses import dataclass
import re
import unicodedata


ENTITY_TYPES = {
    "Mineral", "Rock", "Structure", "TimePeriod", "DepositType", "Region"
}

LATIN_ABBREVIATIONS = {"VMS", "SEDEX", "MVT", "IOCG"}

NOISE_NAMES = {
    "主要", "其中", "分别为", "可分为", "基础上", "分布于", "的分布",
    "岩体中", "摘 要", "摘要", "图", "表", "石矿物", "铁矿矿",
}

NOISE_PREFIXES = (
    "及其", "现行", "相关", "包括", "按照", "根据", "以及", "其中",
    "主要", "一般", "具体", "例如", "分别", "可分", "的", "，", "。",
)

NOISE_SUFFIXES = ("其中", "主要", "分别为", "可分为", "基础上", "分布于", "岩体中")

PUNCTUATION_RE = re.compile(r"[，。；：、？！,.;:!?（）()\[\]{}《》“”‘’\"'\\/]")
ASCII_RE = re.compile(r"[A-Za-z]")
DIGIT_RE = re.compile(r"\d")
CHINESE_RE = re.compile(r"[\u4e00-\u9fff]")
ORIENTATION_RE = re.compile(r"^(?:NE|NW|NNE|NNW|SSE|SSW|EW|SN)向[\u4e00-\u9fff-]+$")


TYPE_SUFFIXES = {
    "Mineral": (
        "矿", "矿物", "石", "晶", "金属", "氧化物", "硫化物",
    ),
    "Rock": (
        "岩", "岩体", "岩群", "岩组", "杂岩", "岩石", "地层", "建造", "侵入体",
    ),
    "Structure": (
        "断裂", "断裂带", "断层", "褶皱", "背斜", "向斜", "构造", "构造带",
        "剪切带", "破碎带", "造山带", "缝合带", "俯冲带", "陆块", "断隆带",
        "褶断带", "岩浆弧", "混杂岩带", "片理化带", "糜棱岩带",
    ),
    "TimePeriod": (
        "宙", "代", "纪", "世", "期", "界", "系", "统", "宇", "群", "组",
    ),
    "DepositType": ("型", "式", "矿床"),
}


@dataclass(frozen=True)
class EntityValidation:
    valid: bool
    name: str
    reason: str = ""


def validate_entity(name: object, entity_type: object) -> EntityValidation:
    normalized = unicodedata.normalize("NFKC", str(name or "")).strip()
    normalized_type = str(entity_type or "").strip()

    if normalized_type not in ENTITY_TYPES:
        return EntityValidation(False, normalized, "unsupported_type")
    if len(normalized) < 2 or len(normalized) > 25:
        return EntityValidation(False, normalized, "invalid_length")
    if any(char.isspace() for char in normalized):
        return EntityValidation(False, normalized, "contains_whitespace")
    if PUNCTUATION_RE.search(normalized):
        return EntityValidation(False, normalized, "contains_punctuation")
    if DIGIT_RE.search(normalized):
        return EntityValidation(False, normalized, "contains_digit")
    if normalized in NOISE_NAMES:
        return EntityValidation(False, normalized, "noise_phrase")
    if normalized.startswith(NOISE_PREFIXES) or normalized.endswith(NOISE_SUFFIXES):
        return EntityValidation(False, normalized, "sentence_fragment")
    if re.search(r"(矿|岩|型)\1$", normalized):
        return EntityValidation(False, normalized, "repeated_suffix")

    if normalized in LATIN_ABBREVIATIONS:
        return EntityValidation(
            normalized_type == "DepositType",
            normalized,
            "type_mismatch" if normalized_type != "DepositType" else "",
        )
    if ASCII_RE.search(normalized) and not ORIENTATION_RE.fullmatch(normalized):
        return EntityValidation(False, normalized, "latin_fragment")
    if len(CHINESE_RE.findall(normalized)) < 2:
        return EntityValidation(False, normalized, "insufficient_chinese")

    suffixes = TYPE_SUFFIXES.get(normalized_type)
    if suffixes and not normalized.endswith(suffixes):
        return EntityValidation(False, normalized, f"type_shape:{normalized_type}")

    return EntityValidation(True, normalized)
