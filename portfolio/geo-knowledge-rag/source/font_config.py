"""Resolve local fonts used by the portfolio builders."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Mapping


ENV_KEYS = {
    "regular": "PORTFOLIO_FONT_REGULAR",
    "bold": "PORTFOLIO_FONT_BOLD",
    "serif": "PORTFOLIO_FONT_SERIF",
    "latin": "PORTFOLIO_FONT_LATIN",
}


def _candidate_paths(environment: Mapping[str, str]) -> dict[str, list[Path]]:
    windows_fonts = Path(environment["WINDIR"]) / "Fonts" if environment.get("WINDIR") else None
    candidates: dict[str, list[Path]] = {
        "regular": [
            Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
            Path("/System/Library/Fonts/PingFang.ttc"),
        ],
        "bold": [
            Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"),
            Path("/System/Library/Fonts/PingFang.ttc"),
        ],
        "serif": [
            Path("/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"),
            Path("/System/Library/Fonts/Supplemental/Songti.ttc"),
        ],
        "latin": [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        ],
    }
    if windows_fonts:
        candidates["regular"].insert(0, windows_fonts / "msyh.ttc")
        candidates["bold"].insert(0, windows_fonts / "msyhbd.ttc")
        candidates["serif"].insert(0, windows_fonts / "simsun.ttc")
        candidates["latin"].insert(0, windows_fonts / "arial.ttf")
    return candidates


def resolve_fonts(environment: Mapping[str, str] | None = None) -> dict[str, Path]:
    environment = os.environ if environment is None else environment
    candidates = _candidate_paths(environment)
    resolved: dict[str, Path] = {}
    for role, env_key in ENV_KEYS.items():
        override = environment.get(env_key)
        if override:
            path = Path(override).expanduser()
            if not path.exists():
                raise FileNotFoundError(f"{env_key} points to a missing font: {path}")
            resolved[role] = path
            continue
        match = next((path for path in candidates[role] if path.exists()), None)
        if match is None:
            searched = ", ".join(str(path) for path in candidates[role])
            raise FileNotFoundError(
                f"No {role} font found. Set {env_key} to a local font file. Searched: {searched}"
            )
        resolved[role] = match
    return resolved
