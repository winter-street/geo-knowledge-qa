"""Shared validation for the Flask retrieval service health contract."""

from typing import Any


def is_current_retrieval_health(payload: Any) -> bool:
    """Accept only the health response required by the backend capability API."""
    if not isinstance(payload, dict) or payload.get("status") != "ok":
        return False
    retrieval = payload.get("retrieval")
    if not isinstance(retrieval, dict):
        return False
    return all(
        isinstance(retrieval.get(mode), dict)
        and isinstance(retrieval[mode].get("available"), bool)
        for mode in ("bge", "tfidf")
    )
